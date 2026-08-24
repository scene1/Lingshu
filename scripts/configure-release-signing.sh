#!/usr/bin/env bash

set -euo pipefail

REPOSITORY="${LINGSHU_RELEASE_REPOSITORY:-scene1/Lingshu}"
COMMAND="${1:-status}"
PLATFORM="${2:-all}"

required_secrets=(
  MAC_CSC_LINK
  MAC_CSC_KEY_PASSWORD
  APPLE_ID
  APPLE_APP_SPECIFIC_PASSWORD
  APPLE_TEAM_ID
  WIN_CSC_LINK
  WIN_CSC_KEY_PASSWORD
)

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

prompt_value() {
  local prompt="$1"
  local value
  read -r -p "$prompt" value
  printf '%s' "$value"
}

prompt_secret() {
  local prompt="$1"
  local value
  read -r -s -p "$prompt" value
  printf '\n' >&2
  printf '%s' "$value"
}

set_secret_text() {
  local name="$1"
  local value="$2"
  [ -n "$value" ] || die "$name cannot be empty"
  printf '%s' "$value" | gh secret set "$name" --repo "$REPOSITORY"
  printf 'Configured %s\n' "$name"
}

set_secret_file() {
  local name="$1"
  local file_path="$2"
  [ -f "$file_path" ] || die "certificate file not found: $file_path"
  openssl base64 -A -in "$file_path" | gh secret set "$name" --repo "$REPOSITORY"
  printf 'Configured %s from %s\n' "$name" "$(basename "$file_path")"
}

validate_pkcs12() {
  local file_path="$1"
  local password="$2"
  local certificate_kind="$3"
  local certificate_info
  [ -f "$file_path" ] || die "certificate file not found: $file_path"
  PKCS12_PASSWORD="$password" openssl pkcs12 \
    -in "$file_path" \
    -passin env:PKCS12_PASSWORD \
    -noout >/dev/null 2>&1 || die "cannot open certificate; check its format and password"
  PKCS12_PASSWORD="$password" openssl pkcs12 \
    -in "$file_path" \
    -passin env:PKCS12_PASSWORD \
    -nocerts \
    -nodes 2>/dev/null | openssl pkey -noout -check >/dev/null 2>&1 \
    || die "certificate does not contain a usable private key"
  certificate_info="$(
    PKCS12_PASSWORD="$password" openssl pkcs12 \
      -in "$file_path" \
      -passin env:PKCS12_PASSWORD \
      -clcerts \
      -nokeys 2>/dev/null \
      | openssl x509 -noout -subject -ext extendedKeyUsage 2>/dev/null
  )" || die "cannot inspect signing certificate"
  if [ "$certificate_kind" = "macos" ]; then
    printf '%s\n' "$certificate_info" | grep -Fq 'Developer ID Application' \
      || die "macOS certificate must be a Developer ID Application certificate"
  else
    printf '%s\n' "$certificate_info" | grep -Eq 'Code Signing|1\.3\.6\.1\.5\.5\.7\.3\.3' \
      || die "Windows certificate must include the Code Signing extended key usage"
  fi
}

show_status() {
  local configured
  configured="$(gh secret list --repo "$REPOSITORY" | awk '{print $1}')"
  printf 'Release signing secrets for %s:\n' "$REPOSITORY"
  for name in "${required_secrets[@]}"; do
    if printf '%s\n' "$configured" | grep -Fxq "$name"; then
      printf '  [configured] %s\n' "$name"
    else
      printf '  [missing]    %s\n' "$name"
    fi
  done
}

configure_macos() {
  local certificate_path certificate_password apple_id app_password team_id
  certificate_path="$(prompt_value 'Developer ID Application .p12 path: ')"
  certificate_password="$(prompt_secret 'Certificate password: ')"
  apple_id="$(prompt_value 'Apple ID used for notarization: ')"
  app_password="$(prompt_secret 'Apple app-specific password: ')"
  team_id="$(prompt_value 'Apple Developer Team ID: ')"

  [[ "$team_id" =~ ^[A-Z0-9]{10}$ ]] || die "Apple Team ID must contain 10 uppercase letters or digits"
  validate_pkcs12 "$certificate_path" "$certificate_password" macos
  set_secret_file MAC_CSC_LINK "$certificate_path"
  set_secret_text MAC_CSC_KEY_PASSWORD "$certificate_password"
  set_secret_text APPLE_ID "$apple_id"
  set_secret_text APPLE_APP_SPECIFIC_PASSWORD "$app_password"
  set_secret_text APPLE_TEAM_ID "$team_id"
  unset certificate_password app_password
}

configure_windows() {
  local certificate_path certificate_password
  certificate_path="$(prompt_value 'Windows code-signing .pfx/.p12 path: ')"
  certificate_password="$(prompt_secret 'Certificate password: ')"

  validate_pkcs12 "$certificate_path" "$certificate_password" windows
  set_secret_file WIN_CSC_LINK "$certificate_path"
  set_secret_text WIN_CSC_KEY_PASSWORD "$certificate_password"
  unset certificate_password
}

require_command gh
require_command openssl
gh auth status >/dev/null 2>&1 || die "authenticate GitHub CLI with: gh auth login"

case "$COMMAND" in
  status)
    show_status
    ;;
  configure)
    case "$PLATFORM" in
      macos)
        configure_macos
        ;;
      windows)
        configure_windows
        ;;
      all)
        configure_macos
        configure_windows
        ;;
      *)
        die "platform must be macos, windows, or all"
        ;;
    esac
    show_status
    ;;
  *)
    die "usage: $0 [status|configure] [macos|windows|all]"
    ;;
esac
