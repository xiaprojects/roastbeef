/*
	autopilotudp_test.go: the Autopilot UDP listener reads each datagram on its own.
*/

package main

import (
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

// A short datagram after a longer one: the listener parses only the bytes it received,
// not the tail of the earlier datagram still in its buffer. Before the fix the old
// $GPRMB in that tail was parsed again, after the new one, and won.
func TestAutopilotUdpParsesOnlyTheReceivedDatagram(t *testing.T) {
	settingsBefore, mutexBefore, dataBefore, statusBefore := globalSettings, autopilot.waypointsDataMutex, autopilot.waypointsData, autopilot.status
	netBefore, loopMutexBefore, loopMapBefore, connsBefore := netMutex, avoidLoopBackMutex, avoidLoopBackMap, clientConnections
	instance := &AutopilotUDPStratuxPlugin{}
	t.Cleanup(func() {
		instance.requestToExit = true
		time.Sleep(2500 * time.Millisecond) // the read deadline is 2 s
		globalSettings, autopilot.waypointsDataMutex, autopilot.waypointsData, autopilot.status = settingsBefore, mutexBefore, dataBefore, statusBefore
		netMutex, avoidLoopBackMutex, avoidLoopBackMap, clientConnections = netBefore, loopMutexBefore, loopMapBefore, connsBefore
	})
	netMutex, avoidLoopBackMutex, avoidLoopBackMap = &sync.Mutex{}, &sync.Mutex{}, make(map[string]string)
	clientConnections = map[string]connection{}
	autopilot.waypointsDataMutex = &sync.Mutex{}

	// A free port for the listener
	probe, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP("127.0.0.1")})
	if err != nil {
		t.Fatal(err)
	}
	port := probe.LocalAddr().(*net.UDPAddr).Port
	probe.Close()
	globalSettings.AutopilotUdp_Enabled = true
	globalSettings.AutopilotUdp_Port = port
	go instance.udpListener()
	time.Sleep(200 * time.Millisecond)

	sender, err := net.DialUDP("udp", nil, &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: port})
	if err != nil {
		t.Fatal(err)
	}
	defer sender.Close()

	gprmb := func(dest string) string {
		return "$GPRMB,A,0.10,L,FROM," + dest + ",4530.000,N,00930.000,E,10.0,090.0,100.0,V*00\n"
	}
	dest := func() string {
		autopilot.waypointsDataMutex.Lock()
		defer autopilot.waypointsDataMutex.Unlock()
		return autopilot.status.GPRMB.WaypointDest
	}
	waitFor := func(want string) string {
		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			if dest() == want {
				return want
			}
			time.Sleep(20 * time.Millisecond)
		}
		return dest()
	}

	// Long: filler first, so the old $GPRMB sits past the end of the short datagram
	long := "$PFILL," + strings.Repeat("X", 200) + "\n" + gprmb("OLD")
	if _, err := sender.Write([]byte(long)); err != nil {
		t.Fatal(err)
	}
	if got := waitFor("OLD"); got != "OLD" {
		t.Fatalf("first datagram not parsed: destination %q", got)
	}

	if _, err := sender.Write([]byte(gprmb("NEW"))); err != nil {
		t.Fatal(err)
	}
	waitFor("NEW")
	time.Sleep(200 * time.Millisecond) // let a re-parsed old tail land, if any
	if got := dest(); got != "NEW" {
		t.Errorf("after the short datagram the destination is %q, want NEW: the old datagram's tail was parsed again", got)
	}
}
