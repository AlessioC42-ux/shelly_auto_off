// The script enables time-controlled automatic shutdown of a machine (e.g., using a Shelly Plug S)
// if it does not have an automatic shutdown mechanism.

// Configuration
let SIMULATION_MODE = false; // In simulation mode (true), short times can be used to test if the script works.
let ENABLE_KEEP_ALIVE = false; // Set to 'false' if the script does not need a periodic function call to stay awake.

// REAL TIMER TIMES (for production use):
let INITIAL_DELAY_MINUTES = 30; // Wait 30 minutes before monitoring begins (Phase 1)
let CHECK_DURATION_MINUTES = 20; // Check for Standby for 20 minutes (Phase 2, Standby confirmation)
let INITIAL_CHECK_DURATION_MINUTES = 15; // Within the first 15 minutes, power consumption must be measured again to confirm the machine has not been manually switched off

let POWER_ON_THRESHOLD = 0.7; 
let POWER_ACTIVE_THRESHOLD = 0.7; // Threshold for immediate emergency shutdown/monitoring
let CHECK_INTERVAL_SECONDS = 60; // Check power every 60 seconds
let KEEP_ALIVE_INTERVAL_SECONDS = 60; // Keep-Alive Timer (only active if ENABLE_KEEP_ALIVE is true)

// Set timer values based on minute inputs
let initialDelay = INITIAL_DELAY_MINUTES * 60 * 1000;
let checkDuration = CHECK_DURATION_MINUTES * 60 * 1000;
let checkInterval = CHECK_INTERVAL_SECONDS * 1000;
let initialCheckDuration = INITIAL_CHECK_DURATION_MINUTES * 60 * 1000;

// *******************************************************************
// *** If you want to get Notifications, you can use this part! ***
// *** IMPORTANT: Insert your actual configuration values here! ***
// *******************************************************************
let SHELLY_CLOUD_BASE_URL = "https://<YOUR-CLUSTER>.shelly.cloud";
let SHELLY_CLOUD_AUTH_KEY = "YOUR_CLOUD_AUTHORIZATION_KEY_HERE";

let SCENE_IDS = {
    "MACHINE_ON": "YOUR_SCENE_ID_FOR_MACHINE_ON",
    "STANDBY_OFF_DETECTED": "YOUR_SCENE_ID_FOR_STANDBY_OFF_DETECTED", // Machine is properly switched off
    "MACHINE_AUTO_OFF": "YOUR_SCENE_ID_FOR_MACHINE_AUTO_OFF", // Shelly-script switched off the machine
};

// *******************************************************************
// *** End of configuration ***
// *******************************************************************

// States for the finite state machine
let STATE = {
    IDLE: 0,
    DELAY: 1, // 30 minutes waiting time, during which the heating/running cycle is observed
    MONITORING: 2 // 20 minutes standby monitoring
};
let scriptState = STATE.IDLE;
let initialTimerHandle = null; // Main timer (30 minutes)
let monitoringTimerHandle = null; // Monitoring timer (every 60s)
let initialCheckTimerHandle = null; // 15-minute confirmation timer
let monitoringStartTime = 0;
let keepAliveTimerHandle = null;
let isHeatingConfirmed = false; // Confirms that the machine is truly running (and wasn't just briefly turned on)

print("Shelly Machine Auto-Off Script started. SIMULATION_MODE: " + SIMULATION_MODE);
print("PROD-INFO: Keep-Alive: " + (ENABLE_KEEP_ALIVE ? "Enabled" : "Disabled") + " | Initial Delay: " + INITIAL_DELAY_MINUTES + " Min. / Check Duration: " + CHECK_DURATION_MINUTES + " Min. / Run Cycle Confirmation in: " + INITIAL_CHECK_DURATION_MINUTES + " Min.");

// Function to send a push notification via a Shelly Cloud Scene
function sendPushNotification(sceneIdentifier) {
    let sceneId = SCENE_IDS[sceneIdentifier];
    if (!sceneId) {
        print("ERROR: No SceneID found for '" + sceneIdentifier + "'.");
        return;
    }
    if (SHELLY_CLOUD_AUTH_KEY === "YOUR_CLOUD_AUTHORIZATION_KEY_HERE" || !SHELLY_CLOUD_AUTH_KEY) {
        print("ERROR: Cloud authorization key not set or incorrect.");
        return;
    }
    let url = SHELLY_CLOUD_BASE_URL + "/scene/manual_run?id=" + sceneId + "&auth_key=" + SHELLY_CLOUD_AUTH_KEY;
    Shelly.call("HTTP.GET", { url: url }, function(response, error_code, error_message) {
        if (error_code) {
            print("ERROR while triggering scene '" + sceneIdentifier + "'. Response from Shelly: " + error_message + " (Code: " + error_code + ")");
        } else {
            print("DEBUG: Scene '" + sceneIdentifier + "' triggered successfully.");
        }
    });
}

// Function to activate or deactivate a Shelly Cloud Scene
function controlSceneActivation(sceneIdentifier, enable) {
    let sceneId = SCENE_IDS[sceneIdentifier];
    if (!sceneId) {
        print("ERROR: No SceneID found for '" + sceneIdentifier + "'.");
        return;
    }
    if (SHELLY_CLOUD_AUTH_KEY === "YOUR_CLOUD_AUTHORIZATION_KEY_HERE" || !SHELLY_CLOUD_AUTH_KEY) {
        print("ERROR: Cloud authorization key not set.");
        return;
    }
    let url = SHELLY_CLOUD_BASE_URL + "/scene/enable?id=" + sceneId + "&auth_key=" + SHELLY_CLOUD_AUTH_KEY;
    url += (enable) ? "&enabled=true" : "&enabled=false";
    Shelly.call("HTTP.GET", { url: url }, function(response, error_code, error_message) {
        if (error_code) {
            print("ERROR while " + (enable ? "enabling" : "disabling") + " scene '" + sceneIdentifier + "'. Response from Shelly: " + error_message + " (Code: " + error_code + ")");
        } else {
            print("DEBUG: Scene '" + sceneIdentifier + "' successfully " + (enable ? "enabled" : "disabled") + ".");
        }
    });
}

// Stops all timers and resets the state
function resetAndStop() {
    if (initialTimerHandle) Timer.clear(initialTimerHandle);
    if (monitoringTimerHandle) Timer.clear(monitoringTimerHandle);
    if (initialCheckTimerHandle) Timer.clear(initialCheckTimerHandle); // Stop Initial Check Timer
    initialTimerHandle = null;
    monitoringTimerHandle = null;
    initialCheckTimerHandle = null;
    scriptState = STATE.IDLE;
    monitoringStartTime = 0;
    isHeatingConfirmed = false; // Reset confirmation
    print("DEBUG: All running cycle timers stopped and state reset to IDLE.");
}

// Triggered when the Initial Check Timer expires (e.g., after 15 min.)
function handleInitialCheckTimeout() {
    if (!isHeatingConfirmed) {
        // The timer has expired, but the machine did not switch on again (run cycle not confirmed).
        print("WARNING: Initial run cycle not confirmed within " + INITIAL_CHECK_DURATION_MINUTES + " minutes. ASSUMPTION: Manual abort/False start.");
        controlSceneActivation("MORNING_TOGGLE_SCENE", false); // Deactivate scene again
        resetAndStop(); // Abort and reset cycle
    } else {
        // The confirmation has occurred, the main DELAY timer continues to run.
        print("DEBUG: Initial check successfully completed. Cycle continues normally.");
    }
    initialCheckTimerHandle = null; // Clear the timer handle
}

// Starts monitoring when the initial delay is over
function startMonitoring() {
    print("DEBUG: Initial delay elapsed. Starting monitoring. Active monitoring duration: " + (checkDuration / 1000) + "s");
    scriptState = STATE.MONITORING;
    // Ensure the Initial Check Timer is definitely stopped
    if (initialCheckTimerHandle) {
        Timer.clear(initialCheckTimerHandle);
        initialCheckTimerHandle = null;
        print("DEBUG: Initial Check Timer stopped because monitoring is starting.");
    }

    sendPushNotification("MONITORING_ACTIVE");
    monitoringStartTime = Date.now();

    monitoringTimerHandle = Timer.set(checkInterval, true, function() {
        let elapsed = Date.now() - monitoringStartTime;
        let elapsedSeconds = Math.round(elapsed / 1000);
        print("DEBUG: Checking for power consumption. Runtime: " + elapsedSeconds + " seconds out of a maximum of " + (checkDuration / 1000) + "s.");

        // Case 1: Monitoring duration exceeded -> Standby detected (Successful shutdown path)
        if (elapsed >= checkDuration) {
            print("DEBUG: *** SHUTDOWN PATH INITIATED *** Monitoring ended (Standby confirmed). SHUTTING DOWN."); 
            sendPushNotification("STANDBY_OFF_DETECTED"); 
            
            // Performs the actual shutdown
            Shelly.call("Switch.Set", { id: 0, on: false }, function(result, error_code, error_message) {
                 if (error_code) {
                    print("ERROR: Could not shut down Shelly: " + error_message);
                } else {
                    print("DEBUG: Shelly successfully shut down.");
                }
            });

            controlSceneActivation("MORNING_TOGGLE_SCENE", true);
            resetAndStop();
            return;
        }
    });
}

// Starts the entire auto-off cycle (DELAY -> MONITORING)
function startAutoOffCycle() {
    // If a cycle is already running, stop it first to ensure a restart
    if (scriptState !== STATE.IDLE) {
        print("DEBUG: Active cycle detected. Stopping it to perform a restart.");
        resetAndStop(); 
    }
    
    print("DEBUG: Power increase detected. Switching to DELAY state and starting initial delay (" + (initialDelay / 1000) + "s).");
    scriptState = STATE.DELAY;
    isHeatingConfirmed = false; // Reset confirmation

    sendPushNotification("MACHINE_ON");
    controlSceneActivation("MORNING_TOGGLE_SCENE", true);
    
    // Start the main timer (30 min)
    initialTimerHandle = Timer.set(initialDelay, false, startMonitoring);
    
    // Start the Initial Check Timer (e.g., 15 min)
    initialCheckTimerHandle = Timer.set(initialCheckDuration, false, handleInitialCheckTimeout);
    print("DEBUG: Initial Check Timer started (" + INITIAL_CHECK_DURATION_MINUTES + " Min.). Waiting for run cycle confirmation.");
}


// Event handler for changes in power consumption (APOWER)
Shelly.addStatusHandler(function(event) {
    if (event.component === "switch:0" && typeof event.delta.apower !== "undefined") {
        let currentPower = event.delta.apower;
        print("DEBUG: Status change switch:0, Power: " + currentPower + "W. Current State: " + scriptState);

        // --- CHECK 1: IMMEDIATE EMERGENCY SHUTDOWN in MONITORING state ---
        if (scriptState === STATE.MONITORING && currentPower >= POWER_ACTIVE_THRESHOLD) {
             print("DEBUG: Power increase (" + currentPower + "W) detected IN MONITORING state. Performing immediate emergency shutdown (MACHINE_AUTO_OFF).");
             Shelly.call("Switch.Set", { id: 0, on: false }); 
             sendPushNotification("MACHINE_AUTO_OFF");
             controlSceneActivation("MORNING_TOGGLE_SCENE", false);
             resetAndStop();
             return; 
        }
        
        // --- CHECK 2: RUN CYCLE CONFIRMATION IN DELAY STATE ---
        if (scriptState === STATE.DELAY) {
            // Power rises again and the Initial Check Timer is still running
            if (currentPower >= POWER_ON_THRESHOLD && !isHeatingConfirmed && initialCheckTimerHandle !== null) {
                isHeatingConfirmed = true;
                Timer.clear(initialCheckTimerHandle); // Stop Initial Check Timer
                initialCheckTimerHandle = null;
                print("DEBUG: Run cycle confirmed (" + currentPower + "W). Initial Check Timer stopped. DELAY timer continues normally.");
                return;
            }
            // If power drops (normal running cycle) or the cycle is already confirmed, 
            // we simply ignore the status change in this phase, as the Initial Check Timer
            // will handle the abort if the 15 minutes expire.
            return;
        }

        // Case 3: Check for power-on event (Starts the cycle only in IDLE state)
        if (currentPower >= POWER_ON_THRESHOLD) {
            if (scriptState === STATE.IDLE) {
                startAutoOffCycle();
            } else {
                // This should only happen in DELAY or MONITORING state and is handled above
                print("DEBUG: Power increase ignored because script is already active (State: " + scriptState + ").");
            }
        }
    }
});

// Controls the Keep-Alive Timer
function startKeepAliveTimer() {
    if (!ENABLE_KEEP_ALIVE) {
        print("DEBUG: Keep-Alive Timer is disabled by configuration.");
        return;
    }
    
    print("DEBUG: Keep-Alive Timer started to keep the script active. Interval: " + KEEP_ALIVE_INTERVAL_SECONDS + "s");
    keepAliveTimerHandle = Timer.set(KEEP_ALIVE_INTERVAL_SECONDS * 1000, true, function() {
        // A simple status call to ensure the script does not go into sleep mode.
        Shelly.call("Shelly.GetStatus", {id: 0});
        print("DEBUG: Keep-Alive check performed.");
    });
}

// INITIALIZATION
startKeepAliveTimer(); // Ensures the script stays awake (if enabled).

// Check the current state on script start (e.g., after a reboot)
Shelly.call("Shelly.GetStatus", {id: 0}, function(result) {
    if (result && result.switch && result.switch[0]) {
        let currentPower = result.switch[0].apower;
        print("DEBUG: Initial Shelly status on script start: " + currentPower + "W.");
        if (currentPower >= POWER_ON_THRESHOLD) {
            print("DEBUG: Machine is active on script start. Starting the cycle.");
            startAutoOffCycle(); // Starts the cycle if already active
        } else {
            print("DEBUG: Machine is not active on script start. Waiting for power increase.");
            scriptState = STATE.IDLE;
        }
    } else {
        print("ERROR: Could not retrieve initial Shelly status. Waiting for power increase.");
        scriptState = STATE.IDLE;
    }
});
