module.exports = {
    SENSOR_EXAMPLE: {
        "type": "ADVA-48",
        "value": "yourMAC",
        "advHeader": {
            "type": "SCAN_RSP",
            "length": 37,
            "txAdd": "random",
            "rxAdd": "public"
        },
        "advData": {
            "manufacturerSpecificData": {
                "companyName": "OMRON Corporation",
                "companyIdentifierCode": "02d5",
                "data": "0343db1caa080180006e05f81184fe270042daffffffffffffffff"
            }
        }
    },
    CALCULATION_EXAMPLE: {
        "type": "ADVA-48",
        "value": "yourMAC",
        "advHeader": {
            "type": "ADV_IND",
            "length": 37,
            "txAdd": "random",
            "rxAdd": "public"
        },
        "advData": {
            "flags": [
                "LE General Discoverable Mode,BR/EDR Not Supported"
            ],
            "manufacturerSpecificData": {
                "companyName": "​OMRON Corporation",
                "companyIdentifierCode": "02d5",
                "data": "0343b90a32100000a5820f00fc1b75009304ff"
            },
            "shortenedLocalName": "Rbt"
        }
    }
}