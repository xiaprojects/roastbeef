import os
import sys
import itertools
import time
import json
import requests

# Function to parse the EDM file (assuming it's similar to previous implementation)
def parse_edm_file(edm_file):
    # Define field widths per D-180 manual
    field_widths = [2, 2, 2, 2, 4, 3, 3, 3, 3, 3, 3, 3, 4, 3, 3, 8, 8, 8, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3]

    edm_data = []
    last_sec_printed = -1

    with open(edm_file, 'r') as in_file:
        for line_number, line in enumerate(in_file, start=1):
            line = line.strip()
            if line == "":
                continue

            line_length = len(line)
            total_width = sum(field_widths)

            if line_length < total_width:
                print(f"Line {line_number} is too short and will be skipped.")
                continue

            fields = [line[i - w: i] for w, i in zip(field_widths, itertools.accumulate(field_widths))]
            
            zulu_time = f"{fields[0]:0>2}:{fields[1]:0>2}:{fields[2]:0>2}"
            sec = int(fields[2])

            if sec != last_sec_printed:
                edm_data.append([zulu_time] + fields[1:])
                last_sec_printed = sec

    return edm_data

def main():
    edm_file = "stream_0620_0032.edm"
    # You can name it as you want, lowercase without symbols, if empty it will drop, use the same name in the JSON mapping
    mapping = ["", "", "",  "", "map", "oiltemperature", "oilpressure", "fuelpressure", "volt", "amps", "rpm", "fuel", "fuelremaining", "fuel1", "fuel2", "", "", "", "termalcouple", "egt1", "egt2", "egt3", "egt4", "", "", "cht1", "cht2", "cht3", "cht4", "", ""]
    moltiplier = [0, 0, 0,  0, 0.02, 0.5, 0.05, 0.05, 0.1, 1.0, 20, 1, 1, 1, 1, 0, 0, 0, 0.5, 0.05, 0.05, 0.05, 0.05, 0, 0, 0.4, 0.4, 0.4, 0.4, 0, 0]

    # Parse EDM and KML files
    edm_data = parse_edm_file(edm_file)
    for x in range(len(edm_data)):
        values = {}
        for y in range(len(edm_data[x])):
            print(mapping[y]+"="+edm_data[x][y])
            # Write this value to Roastbeaf
            if mapping[y] != "":
                # Data shall be already has being prepared as final value
                values[mapping[y]]=int(edm_data[x][y])*moltiplier[y]

        if len(values):
            # Upload data, there are 3 different ways:
            # A) WebSocket, fast, easy, cpu load is medium solution [PREFERRED because is easy to integrate]
            # B) Unix Socket, very fast, requires a bit of coding, cpu load is low
            # C) REST API, thi is not the best but is 1 line of code
            requests.post("http://127.0.0.1/setEMS", json=values)
        time.sleep(1)

if __name__ == "__main__":
    main()