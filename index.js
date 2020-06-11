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
        this.testMode = options && options.testMode;
        this.barnowl = options && options.barnowl
            ? options.existingBarnowl
            : new Barnowl();

        // Check to see if a beacon whitelist was specified
        // Useful for listening to specific devices
        if (options && options.whitelist && Array.isArray(options.whitelist) && options.whitelist.length > 0) {
            this.whitelist = options.whitelist;
        }

        this.handleEvent = this.handleEvent.bind(this);
        this.handleError = this.handleError.bind(this);
        this.isOmronEvent = this.isOmronEvent.bind(this);
        this.passWhitelistCheck = this.passWhitelistCheck.bind(this);

        // Register handlers
        if (!this.testMode) {
            this.barnowl.addListener(BarnowlHci, {}, BarnowlHci.SocketListener, {});
        } else {
            this.barnowl.addListener(Barnowl, {}, Barnowl.TestListener, {});
        }
        
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

        // Take no action if we are in whitelist mode and the event doesn't match a whitelisted sensor ID
        // Take no action on non-Omron events even if it somehow appears to be from a whitelisted device
        if(!this.passWhitelistCheck(reddac) || !this.isOmronEvent(tiraid)) return;

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

        // Emit the results
        this.emit('event', decodedData);

        // Make an emitter for every message type ('sensor', 'calculation')
        this.emit(decodedData.messageType, decodedData);
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
        if(!this.whitelist) return true; // Not in whitelist mode

        return this.whitelist.includes(reddac.transmitterId);
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
                parsed.temperatureF = (parsed.temperature * 9 / 5) + 32; // degF
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