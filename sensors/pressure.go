/*
	This file is part of RB.

	Copyright (C) 2026 XIAPROJECTS SRL

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

	Community edition will be free for all builders and personal use as defined by the licensing model
	Dual licensing for commercial agreement is available
	Please join Discord community
*/
package sensors

// PressureReader provides an interface to a sensor reading pressure and maybe
// temperature or humidity, like the BMP180 or BMP280.
type PressureReader interface {
	Temperature() (temp float64, tempError error) // Temperature returns the temperature in degrees C.
	Pressure() (press float64, pressError error) // Pressure returns the atmospheric pressure in mBar.
	Close() // Close stops reading from the sensor.
}

type AirReader interface {
	Humidity() (hum float64, humError error)   // Humidity returns the relative humidity in %.
	GasResistance() (gas float64, gasError error) // GasResistance returns the gas resistance in Ohm.
	COppm() (co float64, coError error)           // COppm returns the estimated CO concentration in ppm.
}