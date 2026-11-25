/*
	Copyright (c) 2015-2016 Christopher Young
	Distributable under the terms of The "BSD New" License
	that can be found in the LICENSE file, herein included
	as part of this header.

	network.go: Client networking routines, DHCP lease monitoring, queue management, ICMP monitoring.
*/

package main

import (
	"io"
	"log"
	"math/rand"
	"net"
	"strconv"
	"syscall"
	"time"
	"unsafe"

	"github.com/xiaprojects/serial"
	"tinygo.org/x/bluetooth"
)

// Connection interface where we will write data - no matter if UDP, Serial or TCP
type connection interface {
	GetConnectionKey() string // e.g. "192.168.10.22:12345" for udp, "TCP:192.168.10.22:12345" for TCP, "/dev/serialout0" for serialout
	MessageQueue() *MessageQueue
	Writer()       io.Writer
	IsThrottled()  bool
	IsSleeping()   bool
	Capabilities() uint8
	GetDesiredPacketSize() int
	OnError(error)
	Close()
}

// Optional: connections whose writes are absorbed by large kernel buffers
// (serial) pace themselves so the backlog stays in the MessageQueue.
type pacedConnection interface {
	WaitForTxRoom()
	OnWritten(n int)
}

type networkConnection struct {
	Conn            *net.UDPConn
	Ip              string
	Port            uint32
	Capability      uint8
	Queue           *MessageQueue `json:"-"` // don't store in settings

	LastPingResponse time.Time // last time the client responded
	LastPongResponse time.Time // last time the client responded
	LastUnreachable time.Time // Last time the device sent an ICMP Unreachable packet.
	/*
		Sleep mode/throttle variables. "sleep mode" is actually now just a very reduced packet rate, since we don't know positively
		 when a client is ready to accept packets - we just assume so if we don't receive ICMP Unreachable packets in 5 secs.
	*/
	SleepFlag       bool      // Whether or not this client has been marked as sleeping - only used for debugging
}

func (conn *networkConnection) MessageQueue() *MessageQueue {
	if conn.Queue == nil {
		conn.Queue = NewMessageQueue(1024)
	}
	return conn.Queue
}
func (conn *networkConnection) Writer() io.Writer {
	return conn.Conn
}
/*
	isThrottled().
	 Checks if a client identifier 'ip:port' is throttled.
	 Throttle mode is for testing port open and giving some start-up time to the app.
	 Throttling means that we only send important packets for first 15 seconds (location, status, very close traffic).
*/
func (conn *networkConnection) IsThrottled() bool {
	return (rand.Int()%1000 != 0) && stratuxClock.Since(conn.LastUnreachable) < (15*time.Second)
}

/*
	isSleeping().
	 Check if a client identifier 'ip:port' is in either a sleep or active state.
*/
func (conn *networkConnection) IsSleeping() bool {
	// Unable to listen to ICMP without root - send to everything. Just for debugging.
	if isX86DebugMode() || globalSettings.NoSleep == true {
		return false
	}
	// No ping response. Assume disconnected/sleeping device.
	if conn.LastPongResponse.IsZero() || stratuxClock.Since(conn.LastPongResponse) > (10*time.Second) {
		conn.SleepFlag = true
	} else if conn.LastPingResponse.IsZero() || stratuxClock.Since(conn.LastPingResponse) > (10*time.Second) {
		conn.SleepFlag = true
	} else if stratuxClock.Since(conn.LastUnreachable) < (5 * time.Second) {
		conn.SleepFlag = true
	} else {
		conn.SleepFlag = false
	}
	return conn.SleepFlag
}

func (conn *networkConnection) Capabilities() uint8 {
	return conn.Capability
}

func (conn *networkConnection) GetDesiredPacketSize() int {
	if conn.Capabilities() & (NETWORK_POSITION_FFSIM | NETWORK_AHRS_FFSIM) > 0 {
		// Hack: some software doesn't handle X-Plane as a stream correctly, e.g. SkyDemon, and requires each message in a separate packet, or it will crash.
		return 1
	}
	return 1024
}

func (conn *networkConnection) OnError(err error) {
	// Ignore for UDP. We keep the socket always open and just try to push data
	//log.Printf("UDP Write error: %s", err.Error())
}

func (conn *networkConnection) Close() {
	// Ignore for UDP. We keep the socket always open and just try to push data
}

func (conn *networkConnection) GetConnectionKey() string {
	return conn.Ip + ":" + strconv.Itoa(int(conn.Port))
}



type serialConnection struct {
	DeviceString string
	Baud         int
	Capability   uint8
	serialPort   *serial.Port
	Queue        *MessageQueue `json:"-"` // don't store in settings

	// Transmit pacing (only touched by the connectionWriter goroutine).
	// A blocking tty write returns as soon as the bytes are copied into kernel
	// buffers (tty layer, UART xmit ring, cdc-acm URBs), so without pacing the
	// userspace queue empties instantly and messages go stale inside the kernel,
	// where maxAge and priorities cannot drop them.
	txBusyUntil time.Time // when the bytes handed to the kernel so far will have left the wire
	outqFd      int       // second fd on the tty, used only for TIOCOUTQ; 0 = not opened, -1 = unavailable
}

// Maximum transmit backlog allowed below userspace, as time on the wire.
const serialMaxBacklog = 250 * time.Millisecond

// bytesPerSecond assumes 8N1: 10 bits per byte.
func (conn *serialConnection) bytesPerSecond() float64 {
	if conn.Baud <= 0 {
		return 960
	}
	return float64(conn.Baud) / 10
}

// outQueueLen returns the bytes still waiting in the kernel output queue (TIOCOUTQ),
// or -1 if unknown. For cdc-acm this only counts host-side data, not the device FIFO,
// which is why the software pacer below is the primary limit.
func (conn *serialConnection) outQueueLen() int {
	if conn.outqFd == 0 {
		fd, err := syscall.Open(conn.DeviceString, syscall.O_RDONLY|syscall.O_NOCTTY|syscall.O_NONBLOCK, 0)
		if err != nil {
			conn.outqFd = -1
		} else {
			conn.outqFd = fd
		}
	}
	if conn.outqFd < 0 {
		return -1
	}
	var n int32
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(conn.outqFd), uintptr(syscall.TIOCOUTQ), uintptr(unsafe.Pointer(&n))); errno != 0 {
		return -1
	}
	return int(n)
}

// backlog is the larger of the software estimate and what the kernel reports.
func (conn *serialConnection) backlog() time.Duration {
	b := time.Until(conn.txBusyUntil)
	if q := conn.outQueueLen(); q > 0 {
		k := time.Duration(float64(q) / conn.bytesPerSecond() * float64(time.Second))
		if k > b {
			b = k
		}
	}
	if b < 0 {
		b = 0
	}
	return b
}

// WaitForTxRoom blocks until the backlog below userspace is under serialMaxBacklog,
// so unsent messages stay in the MessageQueue where they can expire.
func (conn *serialConnection) WaitForTxRoom() {
	for {
		b := conn.backlog()
		if b <= serialMaxBacklog {
			return
		}
		time.Sleep(b - serialMaxBacklog + 5*time.Millisecond)
	}
}

// OnWritten accounts n bytes handed to the kernel.
func (conn *serialConnection) OnWritten(n int) {
	now := time.Now()
	if conn.txBusyUntil.Before(now) {
		conn.txBusyUntil = now
	}
	conn.txBusyUntil = conn.txBusyUntil.Add(time.Duration(float64(n) / conn.bytesPerSecond() * float64(time.Second)))
}

func (conn *serialConnection) MessageQueue() *MessageQueue {
	if conn.Queue == nil {
		conn.Queue = NewMessageQueue(1024)
	}
	return conn.Queue
}

func (conn *serialConnection) Writer() io.Writer {
	return conn.serialPort
}
// Throttled when more than half the allowed backlog is queued below userspace:
// then only priority <= 0 messages (position, status, crucial traffic) are collected.
func (conn *serialConnection) IsThrottled() bool {
	return conn.backlog() > serialMaxBacklog/2
}
func (conn *serialConnection) IsSleeping() bool {
	return conn.serialPort == nil
}

func (conn *serialConnection) Capabilities() uint8 {
	return conn.Capability
}

func (conn *serialConnection) GetDesiredPacketSize() int {
	return 128
}

func (conn *serialConnection) OnError(err error) {
	// Close connection and queue
	log.Printf("Serial connection %s closed: %s", conn.DeviceString, err.Error())
	conn.Close()
}

func (conn *serialConnection) Close() {
	if conn.serialPort != nil {
		conn.serialPort.Close()
		if conn.outqFd > 0 {
			syscall.Close(conn.outqFd)
			conn.outqFd = -1
		}
		log.Printf("Closed serial port %s", conn.DeviceString)
		conn.Queue.Close()
		onConnectionClosed(conn)
	}
}

func (conn *serialConnection) GetConnectionKey() string {
	return conn.DeviceString
}

type tcpConnection struct {
	Conn         *net.TCPConn
	Queue        *MessageQueue `json:"-"`
	Capability   uint8
	Key          string
}

func (conn *tcpConnection) MessageQueue() *MessageQueue {
	if conn.Queue == nil {
		conn.Queue = NewMessageQueue(1024)
	}
	return conn.Queue
}

func (conn *tcpConnection) Writer() io.Writer {
	return conn.Conn
}
func (conn *tcpConnection) IsThrottled() bool {
	return false
}
func (conn *tcpConnection) IsSleeping() bool {
	return conn.Conn == nil
}
func (conn *tcpConnection) Capabilities() uint8 {
	return conn.Capability
}
func (conn *tcpConnection) GetDesiredPacketSize() int {
	return 512
}

func (conn *tcpConnection) OnError(err error) {
	// Close connection and queue
	if conn.Conn != nil {
		log.Printf("TCP connection %s closed: %s", conn.Conn.RemoteAddr(), err.Error())
		conn.Close()
	}
}

func (conn *tcpConnection) Close() {
	// Close connection and queue
	if conn.Conn != nil {
		conn.Conn.Close()
		conn.Conn = nil
		conn.Queue.Close()
		onConnectionClosed(conn)
	}
}


func (conn *tcpConnection) GetConnectionKey() string {
	return conn.Key
}



type bleConnection struct {
	Capability   uint8
	UUIDService  string // SoftRF: 0xFFE0
	UUIDGatt     string
	Characteristic bluetooth.Characteristic
	Queue        *MessageQueue `json:"-"` // don't store in settings
}

func (conn *bleConnection) MessageQueue() *MessageQueue {
	if conn.Queue == nil {
		conn.Queue = NewMessageQueue(1024)
	}
	return conn.Queue
}

func (conn *bleConnection) Writer() io.Writer {
	return conn
}

func (conn *bleConnection) Write(p []byte) (n int, err error) {
	return conn.Characteristic.Write(p)
}

func (conn *bleConnection) IsThrottled() bool {
	return false
}
func (conn *bleConnection) IsSleeping() bool {
	return false
}

func (conn *bleConnection) Capabilities() uint8 {
	return conn.Capability
}

func (conn *bleConnection) GetDesiredPacketSize() int {
	return 20 // TODO
}

func (conn *bleConnection) OnError(err error) {
	// Close connection and queue
	log.Printf("BLE Error %s", err.Error())
}

func (conn *bleConnection) Close() {
}

func (conn *bleConnection) GetConnectionKey() string {
	return conn.UUIDService
}
