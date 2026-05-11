/*
	This file is part of RB.

	Copyright (C) 2025 XIAPROJECTS SRL

	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, version 3.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with this program. If not, see <https://www.gnu.org/licenses/>.

	This source is part of the project RB:
	01 -> Display with Synthetic vision, Autopilot and ADSB
	02 -> Display with SixPack
	03 -> Display with Autopilot, ADSB, Radio, Flight Computer
	04 -> Display with EMS: Engine monitoring system
	05 -> Display with Stratux BLE Traffic
	06 -> Display with Android 6.25" 7" 8" 10" 10.2"
    07 -> Display with Stratux BLE Traffic composed by RB-05 + RB-03 in the same box
    08 -> Voice Recognition Box with LLM and Natural speaking and Voice Recorder

	Community edition will be free for all builders and personal use as defined by the licensing model
	Dual licensing for commercial agreement is available
	Please join Discord community
*/

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

type OTAStratuxPlugin struct {
	StratuxPlugin
}

var ota = OTAStratuxPlugin{}

func (otaInstance *OTAStratuxPlugin) InitFunc() bool {
	log.Println("Entered OTAStratuxPlugin init() ...")
	otaInstance.Name = "OTA"
	return true
}

func (otaInstance *OTAStratuxPlugin) ShutdownFunc() bool {
	log.Println("Entered OTAStratuxPlugin shutdown() ...")
	return true
}

// UpdateInfo represents the structure of update information from the API
type UpdateInfo struct {
	Version   int    `json:"version"`
	Installed int    `json:"installed"`
	Component string `json:"component"`
	File      string `json:"file"`
	MD5Sum    string `json:"md5sum"`
	Size      int64  `json:"size"`
}

// Config holds the device configuration
type Config struct {
	DeviceID      string `json:"device_id"`
	BaseURL       string `json:"base_url"`
	Authorization string `json:"authorization"`
}

// 1. FetchAvailableUpdates retrieves available updates from the remote API
func (otaInstance *OTAStratuxPlugin) FetchAvailableUpdates() ([]UpdateInfo, error) {
	config, err := otaInstance.loadConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to load config: %w", err)
	}

	url := fmt.Sprintf("%s/updates/%s?Authorization=%s",
		config.BaseURL, config.DeviceID, config.Authorization)

	resp, err := http.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch updates: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned status: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	var updates []UpdateInfo
	if err := json.Unmarshal(body, &updates); err != nil {
		return nil, fmt.Errorf("failed to parse JSON response: %w", err)
	}

	return updates, nil
}

// 2. GetCurrentVersion reads the current installed version for a component
func (otaInstance *OTAStratuxPlugin) GetCurrentVersion(component string) (int, error) {
	filePath := fmt.Sprintf("/opt/stratux/%s.version", component)

	data, err := ioutil.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return -1, fmt.Errorf("file not found %s: %w", filePath, err) // Component not installed
		}
		return -1, fmt.Errorf("failed to read %s: %w", filePath, err)
	}

	versionStr := strings.TrimSpace(string(data))
	version, err := strconv.Atoi(versionStr)
	if err != nil {
		return 0, fmt.Errorf("invalid version format in %s: %w", filePath, err)
	}

	return version, nil
}

// loadConfig reads the configuration from rb-cloud.json
func (otaInstance *OTAStratuxPlugin) loadConfig() (*Config, error) {
	configPath := "/boot/firmware/rb/rb-cloud.json"

	data, err := ioutil.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file %s: %w", configPath, err)
	}

	var config Config
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to parse config JSON: %w", err)
	}

	return &config, nil
}

// 3. GetAvailableUpdates fetches remote updates and compares with local versions
func (otaInstance *OTAStratuxPlugin) GetAvailableUpdates() ([]UpdateInfo, error) {
	remoteUpdates, err := otaInstance.FetchAvailableUpdates()
	if err != nil {
		return nil, err
	}

	var available []UpdateInfo
	for _, update := range remoteUpdates {
		currentVersion, err := otaInstance.GetCurrentVersion(update.Component)
		if err != nil {
			update.Installed = -1
		} else {
			update.Installed = currentVersion
		}
		available = append(available, update)
	}

	return available, nil
}

// 4. ApplyUpdate spawns a TRULY background nohup process that survives parent exit
func (otaInstance *OTAStratuxPlugin) ApplyUpdate(update UpdateInfo) error {
	config, err := otaInstance.loadConfig()
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	fileURL := fmt.Sprintf("%s/updates/%s/%s/download?Authorization=%s", config.BaseURL, config.DeviceID, update.File, config.Authorization)

	// Build the full nohup command as a single string
	updateCmd := fmt.Sprintf(`/opt/stratux/bin/update_script.sh "%s" "stratuxrun" "systemctl start stratux" "%s"`,
		fileURL, update.MD5Sum)

	nohupCmd := fmt.Sprintf(`nohup bash -c '%s' > /tmp/update-%s.log 2>&1 &`,
		updateCmd, update.Component)

	// Execute via bash to ensure proper background detachment
	cmd := exec.Command("/bin/bash", "-c", nohupCmd)

	// No output redirection needed - already handled in nohupCmd
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to spawn background update: %w", err)
	}

	log.Printf("Background update spawned for %s (log: /tmp/update-%s.log)",
		update.Component, update.Component)
	return nil
}
