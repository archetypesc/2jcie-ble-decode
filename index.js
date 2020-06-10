'use strict';

const Barnowl = require('barnowl');
const EventEmitter = require('events');
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
    .uint16("seismicActivity")
    .uint16("accXAxis")
    .uint16("accYAxis")
    .uint16("accZAxis");

const masterParser = new Parser()
    .endianess("little")
    .uint8("dataType")
    .choice("decoded", {
        tag: "dataType",
        choices: {
            1: sensorDataParser,
            3: calculationDataParser
        }
    });


class OmronSensorService {

    constructor(existingBarnowl) {
        barnowl = existingBarnowl || new Barnowl();

        // barnowl.bind({
        //     protocol: 'hci',
        //     path: null
        // });

        // Create an emitter
        this.emitter = new EventEmitter();

        this.handleEvent = this.handleEvent.bind(this);
        this.handleError = this.handleError.bind(this);
        this.isOmronEvent = this.isOmronEvent.bind(this);

        // Register handlers
        barnowl.on('raddec', this.handleEvent)
        barnowl.on('error', this.handleError);

        barnowl.addListener(Barnowl, {}, Barnowl.TestListener, {});
    }

    /**
     * Process a BLE event
     * @param {Object} tiraid The object from barnowl's visibilityEvent
     */
    handleEvent(tiraid) {
        //tiraid = JSON.parse('{"identifier":{"type":"ADVA-48","value":"d13e50866f01","advHeader":{"type":"SCAN_RSP","length":37,"txAdd":"random","rxAdd":"public"},"advData":{"manufacturerSpecificData":{"companyName":"OMRON Corporation","companyIdentifierCode":"02d5","data":"0343db1caa080180006e05f81184fe270042daffffffffffffffff"}}},"timestamp":"2020-06-10T17:22:19.638Z","radioDecodings":[{"rssi":202,"identifier":{"type":"EUI-64","value":"001bc5094b57b86a"}}]}')
        tiraid = JSON.parse('{"identifier":{"type":"ADVA-48","value":"d13e50866f01","advHeader":{"type":"ADV_IND","length":37,"txAdd":"random","rxAdd":"public"},"advData":{"flags":["LE General Discoverable Mode,BR/EDR Not Supported"],"manufacturerSpecificData":{"companyName":"​OMRON Corporation","companyIdentifierCode":"02d5","data":"0343b90a32100000a5820f00fc1b75009304ff"},"shortenedLocalName":"Rbt"}},"timestamp":"2020-06-10T17:22:19.636Z","radioDecodings":[{"rssi":"202","identifier":{"type":"EUI-64","value":"001bc5094b57b86a"}}]}')
        
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
        this.emitter.emit('test', decodedData);
    }

    /**
     * Emit an error to the subscribers
     * @param {Object} err The error object
     */
    handleError(err) {
        this.emitter.emit('error', err);
    }

    /**
     * Check if the event was sent from an Omron device
     * @param {Object} tiraid Raw output from Barnowl
     */
    isOmronEvent(tiraid) {

        console.log(tiraid.identifier.advData.manufacturerSpecificData.companyName);

        return (('advData' in tiraid.identifier)
            && ('manufacturerSpecificData' in tiraid.identifier.advData)
            && ('companyName' in tiraid.identifier.advData.manufacturerSpecificData)
            && tiraid.identifier.advData.manufacturerSpecificData.companyName === "OMRON Corporation");
    }

    /**
     * Decode the data into a usable JSON object
     * @param {string} raw The raw data frame from the Omron packet
     */
    decode(raw) {

        console.log('attempting to decode ' + raw);

        let buf = Buffer.from(raw, "hex");
        return masterParser.parse(buf);
    }


}

module.exports = OmronSensorService;