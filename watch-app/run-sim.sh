#!/usr/bin/env bash
# Build the watch app and run it in the Connect IQ simulator.
#   ./run-sim.sh            build + launch simulator + load app
#   ./run-sim.sh build      build only
#
# Finds the SDK the Garmin SDK Manager marked as current, so monkeyc/connectiq/monkeydo
# don't need to be on PATH. Override with CIQ_SDK=/path/to/sdk.
# Signing key: $CIQ_KEY, else ~/.connectiq/developer_key.der (generated on first run).
set -euo pipefail
cd "$(dirname "$0")"

GARMIN="$HOME/Library/Application Support/Garmin/ConnectIQ"
SDK="${CIQ_SDK:-}"
if [[ -z "$SDK" && -f "$GARMIN/current-sdk.cfg" ]]; then
  SDK="$(tr -d '\n' < "$GARMIN/current-sdk.cfg")"
fi
if [[ -z "$SDK" || ! -x "$SDK/bin/monkeyc" ]]; then
  SDK="$(ls -d "$GARMIN"/Sdks/connectiq-sdk-* 2>/dev/null | sort | tail -1 || true)"
fi
if [[ -z "$SDK" || ! -x "$SDK/bin/monkeyc" ]]; then
  echo "Connect IQ SDK not found. Install it with the Garmin SDK Manager, or set CIQ_SDK." >&2
  exit 1
fi
BIN="${SDK%/}/bin"
echo "SDK: $BIN"

KEY="${CIQ_KEY:-$HOME/.connectiq/developer_key.der}"
if [[ ! -f "$KEY" ]]; then
  echo "No developer key at $KEY. Generating one (keep it; Garmin ties app IDs to it)."
  mkdir -p "$(dirname "$KEY")"
  openssl genrsa -out "${KEY%.der}.pem" 4096 2>/dev/null
  openssl pkcs8 -topk8 -inform PEM -outform DER -in "${KEY%.der}.pem" -out "$KEY" -nocrypt
  chmod 600 "$KEY" "${KEY%.der}.pem"
fi

mkdir -p bin
"$BIN/monkeyc" -f monkey.jungle -d fenix7pro -o bin/ComposureIQ.prg -y "$KEY" -w
[[ "${1:-}" == "build" ]] && exit 0

if ! pgrep -f "ConnectIQ.app/Contents/MacOS/simulator" >/dev/null; then
  echo "Starting simulator..."
  "$BIN/connectiq" &
  sleep 5
fi
echo "Loading app. In the simulator: Settings -> uncheck 'Use Device HTTPS Requirements'."
"$BIN/monkeydo" bin/ComposureIQ.prg fenix7pro
