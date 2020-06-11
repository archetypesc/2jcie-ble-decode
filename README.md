
# 2jcie-ble-decode

A simple package to decode the data frames sent by the 2JCIE-BU01 sensor from Omron

# Description

This package will allow for easy BLE interfacing with the 2JCIE-BU01 sensor from Omron. There are similar sensors that may also work, but are not tested.

# Setup

This package is capable of decoding both "Sensor Data" and "Calculation Data" message types. The sensor only transmits "Sensor Data" by default, but you can use Omron's mobile app to configure it to send both.

| Platform | App Link |
| -- | -- |
| App Store | [ENV Monitor](https://apps.apple.com/us/app/env-monitor/id1438335898) |
| Google Play | [ENV Monitor](https://play.google.com/store/apps/details?id=jp.co.omron.sm.envmonitor) |

# Usage

1. Install the package with `npm i --save 2jcie-ble-decode`
2. Require the dependency
3. Instantiate the dependency with optional configuration
4. Register event handlers

```javascript
const Sensor = require('2jcie-ble-decode');
const sensor = new Sensor({
    testMode: true
});

(() => {
    // Listener for all events
    sensor.on('event', (data) => console.log(data));

    // Listeners for specific event types (options are 'calculation' and 'sensor')
    sensor.on('calculation', handleCalculationData);
    sensor.on('sensor', handleSensorData);

    // Listener for error events
    sensor.on('error', handleErrors);

}) ();
```

### Configuration 
The constructor accepts an options object which can be omitted to accept defaults:

`const sensor = new Sensor();`

You can provide an options object parameter to the Sensor() constructor as follows:
```javascript
const sensor = new Sensor({
	// Activate test mode, which doesn't require Bluetooth hardware or a sensor. 
	// You will receive alternating sample "sensor" and "calculation" events ever 1s
	// Sample events defined in ./mock/example.js
    testMode: false, // defaults to false
    
	// Activate the whitelist.  Ignore any events not originating from one of these addresses
    whitelist: [ 'yourSensorMAC' ], 

	// If omitted, a Barnowl instance will be created and register the BarnowlHci listener
	// Use this if you already have a Barnowl instance in your project and you just want to
	// add the ability to process Omron data frames.
	barnowl: existingBarnowlInstance

});
```
  
### Output

Output will be in the following format:

#### 'sensor' Event Type:
```javascript
{
    "dataType": 3,
    "sequenceNumber": 54,
    "temperature": 23.97,
    "relativeHumidity": 49.25,
    "ambientLight": 361,
    "barometricPressure": 1018.602,
    "soundLevel": 51.58,
    "eTVOC": 25,
    "eCO2": 565,
    "messageType": "sensor",
    "temperatureF": 75.146,
    "deviceId": "d13e50866f01"
}
```
#### 'calculation' Event Type:
```javascript
{
    "dataType": 3,
    "sequenceNumber": 54,
    "discomfortIndex": 70.36,
    "heatStrokeRisk": 20.26,
    "vibration": 0,
    "siValue": 0,
    "peakGroundAcceleration": 0,
    "seismicIntensity": 0,
    "accXAxis": 894.3,
    "accYAxis": 6305.9,
    "accZAxis": 6249.9,
    "messageType": "calculation",
    "deviceId": "d13e50866f01"
}
```

# Resources


OMRON 2JCIE-BU01 Manual: https://omronfs.omron.com/en_US/ecb/products/pdf/A279-E1-01.pdf