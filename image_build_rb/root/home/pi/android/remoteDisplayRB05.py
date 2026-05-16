import socket, serial
# Verify which is the RB-05 or RB-07 serial port
ser = serial.Serial('/dev/ttyACM1', 115200)
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(('0.0.0.0', 2000))

while True:
    data, addr = sock.recvfrom(4096)
    #print(data)
    ser.write(data)