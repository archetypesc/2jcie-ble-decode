'use strict';

const Barnowl = require('barnowl');
const EventEmitter = require('events').EventEmitter;
const Parser = require("binary-parser").Parser;

var barnowl = null;

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

        this.handleEvent = this.handleEvent.bind(this);
        this.handleError = this.handleError.bind(this);
        this.isOmronEvent = this.isOmronEvent.bind(this);

        // Register handlers
        if(!this.testMode){
            this.barnowl.on('visibilityEvent', this.handleEvent);
        } else {
            this.barnowl.on('raddec', this.handleEvent);
            this.barnowl.addListener(Barnowl, {}, Barnowl.TestListener, {});
        }
        
        // Always listen for errors
        this.barnowl.on('error', this.handleError);
    }

    /**
     * Process a BLE event
     * @param {Object} tiraid The object from barnowl's event
     */
    handleEvent(tiraid) {

        // Test Mode overrides Barnowl's tiraid with a realistic OMRON 2JCIE-BU01 event
        // Alternate between the sensor and calculation event types
        if(this.testMode && lastEventType === 'calculation') {
            tiraid = JSON.parse('{"identifier":{"type":"ADVA-48","value":"yourMAC","advHeader":{"type":"SCAN_RSP","length":37,"txAdd":"random","rxAdd":"public"},"advData":{"manufacturerSpecificData":{"companyName":"OMRON Corporation","companyIdentifierCode":"02d5","data":"0343db1caa080180006e05f81184fe270042daffffffffffffffff"}}},"timestamp":"2020-06-10T17:22:19.638Z","radioDecodings":[{"rssi":202,"identifier":{"type":"EUI-64","value":"somevalue"}}]}');
            lastEventType = 'sensor';
        } else if(this.testMode && lastEventType === 'sensor') {
            tiraid = JSON.parse('{"identifier":{"type":"ADVA-48","value":"yourMAC","advHeader":{"type":"ADV_IND","length":37,"txAdd":"random","rxAdd":"public"},"advData":{"flags":["LE General Discoverable Mode,BR/EDR Not Supported"],"manufacturerSpecificData":{"companyName":"​OMRON Corporation","companyIdentifierCode":"02d5","data":"0343b90a32100000a5820f00fc1b75009304ff"},"shortenedLocalName":"Rbt"}},"timestamp":"2020-06-10T17:22:19.636Z","radioDecodings":[{"rssi":"202","identifier":{"type":"EUI-64","value":"somevalue"}}]}');
            lastEventType = 'calculation';
        }
        
        // Take no action on non-Omron events
        if (!this.isOmronEvent(tiraid)) return;

        let rawData = tiraid.identifier.advData.manufacturerSpecificData.data;

        // Emit an error if we can't read the data field
        if (!rawData) {
            this.handleError(new Error(`No data found in Omron packet: ${JSON.stringify(tiraid)}`));
            return;
        }

        // Decode the data from the hex payload
        let decodedData = this.decode(rawData);

        // Emit the results
        //this.emitter.emit('test', decodedData);
        this.emit('test', decodedData);
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
        return (tiraid.identifier
            && tiraid.identifier.advData
            && tiraid.identifier.advData.manufacturerSpecificData
            && tiraid.identifier.advData.manufacturerSpecificData.companyName)
            
            // Note that this line uses .includes() instead of an equality check becuase it seems that the first character in companyName
            // is an invisible "ZERO WIDTH SPACE" unicode character. https://www.fileformat.info/info/unicode/char/200b/index.htm
            && tiraid.identifier.advData.manufacturerSpecificData.companyName.includes("OMRON Corporation");
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
        switch(raw.length) {
            case 38:
                parsed = sensorDataParser.parse(buf);

                // Perform applicable transformations (see page 102 https://omronfs.omron.com/en_US/ecb/products/pdf/A279-E1-01.pdf)
                parsed.temperature /= 100; // degC
                parsed.temperatureF = (parsed.temperature * 9/5) + 32; // degF
                parsed.relativeHumidity /= 100; // %RH
                parsed.barometricPressure /= 1000; // hPa
                parsed.soundLevel /= 100; // dB

                break;
            case 54:
                parsed = calculationDataParser.parse(buf);

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