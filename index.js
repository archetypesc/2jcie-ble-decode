'use strict';

const Barnowl = require('barnowl');
const BarnowlHci = require('barnowl-hci');
const advlib = require('advlib');
const EventEmitter = require('events').EventEmitter;
const Parser = require("binary-parser").Parser;

// Example data for test mode
const mock = require('./mock/example');

const sensorDataParser = new Parser()
    .endianess("little")
    .uint8("dataType")
    .uint8("sequenceNumber")
    .uint16("temperature")
    .uint16("relativeHumidity")
    .uint16("ambientLight")
    .uint32("barometricPressure")
    .uint16("soundLevel")
    .uint16("eTVOC")
    .uint16("eCO2");

const calculationDataParser = new Parser()
    .endianess("little")
    .uint8("dataType")
    .uint8("sequenceNumber")
    .uint16("discomfortIndex")
    .uint16("heatStrokeRisk")
    .uint8("vibration")
    .uint16("siValue")
    .uint16("peakGroundAcceleration")
    .uint16("seismicIntensity")
    .uint16("accXAxis")
    .uint16("accYAxis")
    .uint16("accZAxis");

var lastEventType = 'calculation';

class OmronSensorService extends EventEmitter {

    constructor(options) {
        super();

        // Read options
        this.testMode = options && options.testMode
            ? options.testMode === true
            : false;
        this.barnowl = options && options.barnowl
            ? options.barnowl
            : new Barnowl(); // Default to new Barnowl instance
        this.interval = options && options.interval
            ? options.interval
            : 0; // Default interval is zero

        // Check to see if a beacon whitelist was specified
        // Useful for listening to specific devices
        if (options && options.whitelist && Array.isArray(options.whitelist) && options.whitelist.length > 0) {
            this.whitelist = options.whitelist;
        }

        this.handleEvent = this.handleEvent.bind(this);
        this.handleError = this.handleError.bind(this);
        this.isOmronEvent = this.isOmronEvent.bind(this);
        this.passWhitelistCheck = this.passWhitelistCheck.bind(this);
        this.isInvalidEvent = this.isInvalidEvent.bind(this);
        this.isCooledDown = this.isCooledDown.bind(this);
        this.isDuplicateEvent = this.isDuplicateEvent.bind(this);

        this.lastEventRecords = { 'sensor': [], 'calculation': [] };
        this.lastSequenceNumber = { 'sensor': [], 'calculation': [] };

        // Register listeners
        if (!(options && options.barnowl)) {
            if (!this.testMode) {
                this.barnowl.addListener(BarnowlHci, {}, BarnowlHci.SocketListener, {});
            } else {
                this.barnowl.addListener(Barnowl, {}, Barnowl.TestListener, {});
            }
        }

        // Register handlers
        this.barnowl.on('raddec', this.handleEvent);
        this.barnowl.on('error', this.handleError);
    }

    /**
     * Process a BLE event
     * @param {Object} reddac The object from barnowl's event
     */
    handleEvent(reddac) {

        let tiraid = advlib.ble.process(reddac.packets[0]);

        // Test Mode overrides BarnowlHci's event with a realistic OMRON 2JCIE-BU01 event
        // Alternate between the sensor and calculation event types
        if (this.testMode && lastEventType === 'calculation') {
            tiraid = mock.SENSOR_EXAMPLE;
            lastEventType = 'sensor';
        } else if (this.testMode && lastEventType === 'sensor') {
            tiraid = mock.CALCULATION_EXAMPLE;
            lastEventType = 'calculation';
        }

        // Event filter rules
        if (!this.passEventChecks(reddac, tiraid)) return;

        // Extract OMRON data frame contents
        let rawData = tiraid.advData.manufacturerSpecificData.data;

        // Emit an error if we can't read the data field
        if (!rawData) {
            this.handleError(new Error(`No data found in Omron packet: ${JSON.stringify(tiraid)}`));
            return;
        }

        // Decode the data from the hex payload
        let decodedData = this.decode(rawData);
        // Enrich the response with the OMRON device's MAC
        decodedData.deviceId = tiraid.value;

        // Perform post-decoding checks
        if (!this.passDataChecks(decodedData)) return;

        // Emit the results
        this.emit('event', decodedData);

        // Make an emitter for every message type ('sensor', 'calculation')
        this.emit(decodedData.messageType, decodedData);

        // Update the cooldown & sequence number
        this.lastEventRecords[decodedData.messageType][tiraid.value] = new Date();
        this.lastSequenceNumber[decodedData.messageType][tiraid.value] = decodedData.sequenceNumber;
    }

    /**
     * Pre-decoding filter checks
     * @param {Object} raddec The Raddec object
     * @param {Object} tiraid The decoded data from the Raddec's packet
     */
    passEventChecks(raddec, tiraid) {
        // Take no action if we are in whitelist mode and the event doesn't match a whitelisted sensor ID
        if (!this.passWhitelistCheck(raddec)) return false;

        // Take no action on non-Omron events even if it somehow appears to be from a whitelisted device
        if (!this.isOmronEvent(tiraid)) return false;

        // All checks pass
        return true;
    }

    /**
     * Check to see if the data passes the checks before emitting event
     * @param {Object} decodedData Decoded data packet
     */
    passDataChecks(decodedData) {
        // Take no action if the cooldown has not elapsed
        if (!this.isCooledDown(decodedData)) return false;

        // Dump the frame if it's just zeroes
        // This happens for the first few events when the sensor is just starting up
        if (this.isInvalidEvent(decodedData)) return false;

        // Do not send duplicate events which seem to be emitted directly from the device
        if (this.isDuplicateEvent(decodedData)) return false;

        return true;
    }

    /**
     * Emit an error to the subscribers
     * @param {Object} err The error object
     */
    handleError(err) {
        this.emit('error', err);
    }

    /**
     * Check if the event was sent from an Omron device
     * @param {Object} tiraid Raw output from Barnowl
     */
    isOmronEvent(tiraid) {
        return (tiraid
            && tiraid.advData
            && tiraid.advData.manufacturerSpecificData
            && tiraid.advData.manufacturerSpecificData.companyName)

            // Note that this line uses .includes() instead of an equality check becuase it seems that the first character in companyName
            // is an invisible "ZERO WIDTH SPACE" unicode character. https://www.fileformat.info/info/unicode/char/200b/index.htm
            && tiraid.advData.manufacturerSpecificData.companyName.includes("OMRON Corporation");
    }

    /**
     * Check to see if the transmission came from an allowed sensor
     * @param {Object} reddac The reddac object received by Barnowl
     */
    passWhitelistCheck(reddac) {
        if (!this.whitelist) return true; // Not in whitelist mode

        return this.whitelist.includes(reddac.transmitterId);
    }

    /**
     * Check to see if an event is all zeroes.
     * This happens when a sensor is just booting up
     * @param {Object} event Decoded event
     */
    isInvalidEvent(event) {
        switch (event.messageType) {
            case 'sensor':
                return event.temperature === 0
                    && event.relativeHumidity === 0
                    && event.ambientLight === 0
                    && event.barometricPressure === 0;
            case 'calculation':
                return event.accXAxis === 0
                    && event.accYAxis === 0
                    && event.accZAxis === 0
                    && event.discomfortIndex === 0
                    && event.heatStrokeRisk === 0;
            default:
                this.handleError(new Error(`Could not check validity of message type ${event.messageType}`));
        }
    }

    /**
     * Check to see if it has been long enough since we sent an 
     * event for this device
     * @param {string} event The decoded message
     */
    isCooledDown(event) {
        if (this.interval === 0) return true; // No interval defined

        let now = new Date();
        let lastEvent = this.lastEventRecords[event.messageType][event.deviceId];

        if (!lastEvent) return true; // First ever event for this sensor

        return now - lastEvent >= this.interval * 1000;
    }

    /**
     * Check to see if the event with this seq. ID has already been emitted
     * @param {Object} event The event under consideration for emission
     */
    isDuplicateEvent(event) {

        if (this.testMode) return false; // Disable this check in test mode

        let prevSequence = this.lastSequenceNumber[event.messageType] && this.lastSequenceNumber[event.messageType][event.deviceId]
            ? this.lastSequenceNumber[event.messageType][event.deviceId]
            : null;

        if (!prevSequence) return false; // No previous record

        return event.sequenceNumber === prevSequence;
    }

    /**
     * Decode the data into a usable JSON object
     * @param {string} raw The raw data frame from the Omron packet
     */
    decode(raw) {
        let parsed;
        let buf = Buffer.from(raw, "hex");

        // Determine frame type by length since they both have the same "dataType" value of 3.  If they used different values
        // then we could use the built-in functionality of the binary-parser package 
        // to auto-select a parser https://www.npmjs.com/package/binary-parser#choicename-options
        switch (raw.length) {
            case 38:
                parsed = sensorDataParser.parse(buf);

                // Enrich with message type
                parsed.messageType = 'sensor';

                // Perform applicable transformations (see page 102 https://omronfs.omron.com/en_US/ecb/products/pdf/A279-E1-01.pdf)
                parsed.temperature /= 100; // degC
                // https://stackoverflow.com/a/41716722/5354201
                parsed.temperatureF = Math.round((Number.EPSILON + (parsed.temperature * 9 / 5) + 32) * 100) / 100; // degF
                parsed.relativeHumidity /= 100; // %RH
                parsed.barometricPressure /= 1000; // hPa
                parsed.soundLevel /= 100; // dB

                break;
            case 54:
                parsed = calculationDataParser.parse(buf);

                // Enrich with message type
                parsed.messageType = 'calculation';

                // Perform applicable transformations (see page 102-103 https://omronfs.omron.com/en_US/ecb/products/pdf/A279-E1-01.pdf)
                parsed.discomfortIndex /= 100; // scale of 0 to 100
                parsed.heatStrokeRisk /= 100; // scale of -40 to 125
                parsed.peakGroundAcceleration /= 10; // gal
                parsed.siValue /= 10; // kine
                parsed.seismicIntensity /= 1000; // scale of 0.000 to 65.535
                parsed.accXAxis /= 10; // gal
                parsed.accYAxis /= 10; // gal
                parsed.accZAxis /= 10; // gal

                break;
            default:
                this.handleError(new Error(`Unrecognized data frame with length ${raw.length}`));
                break;
        }

        return parsed;
    }
}

module.exports = OmronSensorService;