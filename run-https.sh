#!/bin/bash
# DeviceMotion / DeviceOrientation need a secure context. http://LAN-IP is not one.
set -e
cd "$(dirname "$0")"
mkdir -p .certs
CERT=.certs/cert.pem
KEY=.certs/key.pem
SANS=DNS:localhost,IP:127.0.0.1
while read -r ip; do
  SANS="$SANS,IP:$ip"
done < <(ifconfig | awk '/inet / && $2 != "127.0.0.1" { print $2 }')
if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
  openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
    -keyout "$KEY" -out "$CERT" \
    -subj "/CN=localhost" \
    -addext "subjectAltName=$SANS"
fi
echo "Phone: https://<lan-ip>:8443/tilt.html  (accept the cert warning, then Enable)"
echo "SANs: $SANS"
http-server -c-1 -p 8443 -S -C "$CERT" -K "$KEY"
