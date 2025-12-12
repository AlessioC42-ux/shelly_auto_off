# **Shelly Auto-Off Script (Machine Auto-Off Script)**

## **Overview**

This script is designed for the automatic, time-controlled shutdown of appliances (e.g., an espresso machine or washing machine) operated via a Shelly Plug S (or any other Shelly device with power metering). It emulates an automatic switch-off mechanism by monitoring the device's normal operating cycle.

## **How It Works**

The script operates based on a three-stage logic:

1. **Activation (IDLE \-\> DELAY):**  
   * When a power consumption above the POWER\_ON\_THRESHOLD is detected (device switched on), the script starts the cycle.  
   * Concurrently, an **Initial Check Timer** starts to ensure the device is genuinely entering a heating/working cycle (protecting against "False Starts").  
2. **Delay Phase (DELAY):**  
   * The script waits for a defined INITIAL\_DELAY\_MINUTES (e.g., 30 minutes), during which the device's normal operation occurs.  
   * **Confirmation:** If the power repeatedly increases during this delay (isHeatingConfirmed), the cycle is confirmed as valid. If the power drops too soon without confirmation, the script aborts and resets.  
3. **Monitoring Phase (MONITORING):**  
   * After the delay elapses, the actual standby monitoring begins for the duration of CHECK\_DURATION\_MINUTES (e.g., 20 minutes).  
   * **Successful Shutdown:** If the power consumption remains below the threshold (standby) throughout the entire monitoring phase, the Shelly won't switch off, because the device is then regulary switched off.  
   * **Emergency Shutdown:** If the power consumption rises again above the POWER\_ACTIVE\_THRESHOLD during this phase, the Shelly is immediately switched off (Emergency Stop).

## **Configuration**

Key configurable parameters in the script header:

* SIMULATION\_MODE: Reduces timer values for quick testing.  
* **ENABLE\_KEEP\_ALIVE:** Controls whether the script performs a regular internal call to prevent the Shelly from putting the script process to sleep.  
* INITIAL\_DELAY\_MINUTES: Wait time before standby monitoring begins (e.g., duration of normal operation).  
* CHECK\_DURATION\_MINUTES: How long the power must remain in the standby range before shutting down.  
* POWER\_ON\_THRESHOLD: Threshold at which the script recognizes the device starting up (typically low, e.g., 0.1W).  
* SHELLY\_CLOUD\_AUTH\_KEY & SCENE\_IDS: Must be configured for push notifications or enabling/disabling Cloud Scenes.
