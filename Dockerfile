# Image for building Stratux
#
FROM debian:trixie

# file and nano are nice to have
RUN apt-get update \
  && apt-get -y install file \
  && apt-get -y install nano \
  && apt-get -y install make \
  && apt-get -y install git \
  && apt-get -y install gcc \
  && apt-get -y install ncurses-dev \
  && apt-get -y install wget \
  && apt-get -y install ca-certificates \
  && apt-get -y install libusb-1.0-0-dev \
  && apt-get -y install python3
# python3 (stdlib only) runs scripts/trace.py, the requirements trace in `make check`.

# Go is installed from upstream, not from Debian's golang-go: Trixie ships Go 1.24 and
# patches the default to GOTOOLCHAIN=local, so it refuses to build go.mod's `go 1.27`
# ("go.mod requires go >= 1.27 ... GOTOOLCHAIN=local") and cannot satisfy
# golang.org/x/exp (>= 1.26) or tinygo.org/x/bluetooth (>= 1.25) either. Pinned and
# checksummed so the build stays reproducible; bump GO_VERSION + GO_SHA256 together
# from https://go.dev/dl/ (linux-arm64 archive, matching docker-compose's platform).
ARG GO_VERSION=1.27.3
ARG GO_SHA256=a06e99309dbcbdca1a8ccd2282c3ee146e55930886e26b4f1193269587165f49
RUN cd /tmp \
    && wget -q "https://go.dev/dl/go${GO_VERSION}.linux-arm64.tar.gz" \
    && echo "${GO_SHA256}  go${GO_VERSION}.linux-arm64.tar.gz" | sha256sum -c - \
    && tar -C /usr/local -xzf "go${GO_VERSION}.linux-arm64.tar.gz" \
    && rm "go${GO_VERSION}.linux-arm64.tar.gz"
ENV PATH="/usr/local/go/bin:${PATH}"
# Make the pinned toolchain authoritative: a go.mod that outgrows it must fail here
# (bump GO_VERSION) rather than silently downloading a different compiler mid-build.
ENV GOTOOLCHAIN=local

RUN cd /tmp \
    && wget https://github.com/stratux/rtlsdr/releases/download/v1.0/librtlsdr0_2.0.2-2_arm64.deb \
    && dpkg -i librtlsdr0_2.0.2-2_arm64.deb

RUN cd /tmp \
    && wget https://github.com/stratux/rtlsdr/releases/download/v1.0/librtlsdr-dev_2.0.2-2_arm64.deb \
    && dpkg -i librtlsdr-dev_2.0.2-2_arm64.deb

# specific to debian, ubuntu images come with user 'ubuntu' that is uid 1000
ENV USERNAME="stratux"
ENV USER_HOME=/home/$USERNAME

RUN useradd -m -d $USER_HOME -s /bin/bash $USERNAME \
    && echo "$USERNAME ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers
