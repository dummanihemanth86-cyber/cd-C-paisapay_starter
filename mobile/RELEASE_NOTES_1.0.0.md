# PaisaPay Android APK 1.0.0

This is the first customer-facing Android APK for direct installation. It contains the PaisaPay Public Mobile App only; it does not include the Admin application.

## Production configuration

- API origin: `https://paisapay-api.onrender.com`
- Android application ID: `com.paisapay.app`
- Release signing: a dedicated PaisaPay release key stored outside the repository.
- Login codes: delivered only through the server's configured production OTP provider. No demo code or test OTP is included in the release UI.

## Financial features

Deposits, withdrawals, Quick Deposit matching, payment verification, wallet mutations, and payouts remain unavailable while the backend financial safety gate is disabled and approved payment/payout integrations are not configured. A UPI recipient or payment screenshot is not proof of payment. This APK does not claim or simulate successful payments.

## Installation

Install `app-release.apk` on a compatible Android device. Confirm the signer and compare the APK SHA-256 checksum supplied with the release artifact before installation.
