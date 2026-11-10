import { FINANCIAL_OPERATION_ROUTE_MANIFEST, FINANCIAL_OPERATIONS_DISABLED_CODE } from './middleware/financialOperations.js';

const openapiBase = {
  openapi: '3.0.3',
  info: { title: 'PaisaPay API', version: '1.0.0', description: 'INR-only API. Cashfree sandbox checkout can be enabled for non-redeemable testing. Production payments and payouts remain disabled until approved providers are configured.' },
  servers: [{ url: '/api/v1' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    schemas: { Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } }, required: ['code', 'message'] } } } },
  },
  paths: {
    '/admin/app-version': {
      get: {
        security: [],
        summary: 'Public Admin app/API build metadata for staging update checks; returns no secrets or account data',
        responses: {
          '200': {
            description: 'Public PaisaPay API version and deployment metadata',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['service', 'apiVersion', 'buildId', 'deploymentEnvironment'],
                  additionalProperties: false,
                  properties: {
                    service: { type: 'string', enum: ['paisapay-api'] },
                    apiVersion: { type: 'string' },
                    buildId: { type: 'string', maxLength: 40 },
                    deploymentEnvironment: { type: 'string', enum: ['staging', 'production', 'development', 'test'] },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/config': { get: { summary: 'Public INR/payment-method configuration and server-authoritative financial action availability', responses: { '200': { description: 'Configuration and fail-closed financial capabilities; mutation routes remain authoritative' } } } },
    '/auth/request-otp': { post: {
      summary: 'Request an OTP delivered through the configured server-side SMS provider',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: {
          type: 'object',
          required: ['phoneE164'],
          additionalProperties: false,
          properties: { phoneE164: { type: 'string', pattern: '^\\+[1-9]\\d{7,14}$', example: '+919876543210', description: 'Phone number in international E.164 format.' } },
        } } },
      },
      responses: {
        '202': { description: 'OTP challenge accepted; provider acceptance does not confirm handset delivery' },
        '400': { description: 'Missing or invalid phoneE164 JSON field' },
        '429': { description: 'Rate limited' },
        '503': { description: 'OTP provider unavailable, timed out, or rejected the request' },
      },
    } },
    '/auth/otp-status/{challengeId}': { get: { summary: 'Check gateway SMS state without exposing gateway credentials or message contents', parameters: [{ in: 'path', name: 'challengeId', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Latest accepted, sent, delivered, failed, or unknown state' }, '503': { description: 'Gateway status unavailable' } } } },
    '/auth/verify-otp': { post: {
      summary: 'Verify an OTP challenge and create a session',
      requestBody: {
        required: true,
        content: { 'application/json': {
          schema: {
            type: 'object',
            required: ['challengeId', 'phoneE164', 'code'],
            additionalProperties: false,
            properties: {
              challengeId: { type: 'string', format: 'uuid' },
              phoneE164: { type: 'string', pattern: '^\\+[1-9]\\d{7,14}$', example: '+919876543210' },
              code: { type: 'string', pattern: '^\\d{6}$', example: '123456' },
            },
          },
          example: { challengeId: '00000000-0000-4000-8000-000000000001', phoneE164: '+919876543210', code: '123456' },
        } },
      },
      responses: {
        '200': { description: 'Session created' },
        '400': { description: 'Missing or invalid challengeId, phoneE164, or code' },
        '401': { description: 'Invalid or expired OTP' },
      },
    } },
    '/auth/register/request-otp': { post: { summary: 'Request a registration OTP; existing accounts receive a generic registration response', responses: { '202': { description: 'Registration challenge created' }, '409': { description: 'Registration unavailable for this number' }, '503': { description: 'SMS provider unavailable' } } } },
    '/auth/register/verify-otp': { post: { summary: 'Verify registration OTP and create an account with a server-hashed password', responses: { '201': { description: 'Account created; sign in separately' }, '401': { description: 'Invalid or expired registration OTP' } } } },
    '/auth/forgot-password/request-otp': { post: { summary: 'Request a five-minute password-reset OTP through the configured server-side SMS provider', responses: { '202': { description: 'Generic reset request accepted; OTP is not included in the response' }, '429': { description: 'Rate limited or resend cooldown active' }, '503': { description: 'SMS provider unavailable' } } } },
    '/auth/password/login': { post: { summary: 'Sign in using a registered phone number and password', responses: { '200': { description: 'Session created' }, '400': { description: 'Request body validation failed' }, '401': { description: 'Invalid credentials' }, '429': { description: 'Rate limited or account temporarily locked' } } } },
    '/auth/password/reset': { post: { summary: 'Reset a password using a valid six-digit SMS challenge; all sessions are revoked', responses: { '200': { description: 'Password changed' }, '401': { description: 'Invalid, expired, or unaccepted reset code' }, '429': { description: 'Too many incorrect codes' } } } },
    '/auth/refresh': { post: { summary: 'Rotate an expiring session', responses: { '200': { description: 'Tokens rotated' } } } },
    '/admin/auth/login': { post: { summary: 'Sign in to the separate Admin app using an existing active account provisioned with an administrator role', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['phoneE164', 'password'], properties: { phoneE164: { type: 'string', example: '+919876543210' }, password: { type: 'string', format: 'password' } } } } } }, responses: { '200': { description: 'Administrator session tokens and role' }, '401': { description: 'Invalid credentials or account is not an active provisioned admin' }, '429': { description: 'Admin login rate limit exceeded' } } } },
    '/admin/auth/forgot-password/request-otp': { post: {
      summary: 'Request a reset code for an active Admin account; the generic response does not reveal whether the phone is registered',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['phoneE164'], additionalProperties: false, properties: { phoneE164: { type: 'string', pattern: '^\\+[1-9]\\d{7,14}$' } } }, example: { phoneE164: '+919876543210' } } } },
      responses: {
        '202': { description: 'Generic reset request accepted', content: { 'application/json': { schema: { type: 'object', required: ['challengeId', 'expiresInSeconds', 'resendAfterSeconds', 'message'], properties: { challengeId: { type: 'string', format: 'uuid' }, expiresInSeconds: { type: 'integer', example: 300 }, resendAfterSeconds: { type: 'integer', example: 60 }, message: { type: 'string' } } } } } },
        '400': { description: 'Invalid phone number', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } },
        '429': { description: 'Admin password-reset rate limit exceeded', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } },
        '503': { description: 'Configured SMS provider unavailable', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } },
      },
    } },
    '/admin/auth/password/reset': { post: {
      summary: 'Reset an active Admin password using a valid six-digit SMS OTP; all existing sessions are revoked',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['phoneE164', 'challengeId', 'code', 'newPassword'], additionalProperties: false, properties: { phoneE164: { type: 'string', pattern: '^\\+[1-9]\\d{7,14}$' }, challengeId: { type: 'string', format: 'uuid' }, code: { type: 'string', pattern: '^\\d{6}$' }, newPassword: { type: 'string', minLength: 12, maxLength: 128, format: 'password' } } }, example: { phoneE164: '+919876543210', challengeId: '00000000-0000-4000-8000-000000000001', code: '123456', newPassword: 'ReplaceWithSecureAdminPassword1!' } } } },
      responses: {
        '200': { description: 'Password reset and prior sessions revoked', content: { 'application/json': { schema: { type: 'object', required: ['ok', 'message'], properties: { ok: { type: 'boolean', enum: [true] }, message: { type: 'string' } } } } } },
        '400': { description: 'Invalid reset request', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } },
        '401': { description: 'Invalid, expired, non-admin, or unaccepted reset code', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } },
        '429': { description: 'Reset attempt limit exceeded', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } },
      },
    } },
    '/users/me': {
      get: { security: [{ bearerAuth: [] }], summary: 'Get current profile', responses: { '200': { description: 'Profile' } } },
      patch: {
        security: [{ bearerAuth: [] }],
        summary: 'Complete/update current profile',
        requestBody: {
          required: true,
          content: { 'application/json': {
            schema: {
              type: 'object',
              minProperties: 1,
              additionalProperties: false,
              properties: {
                displayName: { type: 'string', minLength: 2, maxLength: 80, description: 'Trimmed display name.' },
                avatarId: { type: 'string', nullable: true, enum: ['boy_aarav', 'boy_veer', 'boy_kabir', 'girl_anya', 'girl_myra', 'girl_tara'], description: 'Select one supported avatar or null to clear it.' },
                referralCode: { type: 'string', minLength: 4, maxLength: 60, description: 'Optional referral code; it is linked only when the account has no existing referrer.' },
              },
            },
            example: { displayName: 'Hemanth', avatarId: 'boy_aarav' },
          } },
        },
        responses: {
          '200': { description: 'Updated profile' },
          '400': { description: 'No profile field supplied, invalid field/value, or referral code is invalid' },
          '401': { description: 'Authentication required' },
        },
      },
    },
    '/users/me/upi': {
      get: { security: [{ bearerAuth: [] }], summary: 'Read the signed-in user UPI ID and verification state', responses: { '200': { description: 'Saved UPI ID; format validation is not ownership verification' } } },
      patch: {
        security: [{ bearerAuth: [] }],
        summary: 'Save a format-checked UPI ID and account name; UPI ownership remains unverified',
        requestBody: {
          required: true,
          content: { 'application/json': {
            schema: {
              type: 'object',
              required: ['upiId'],
              properties: {
                upiId: { type: 'string', minLength: 3, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{1,48}@[A-Za-z0-9][A-Za-z0-9.-]{1,48}$', description: 'UPI ID in name@provider format.' },
                displayName: { type: 'string', minLength: 2, maxLength: 100, description: 'Preferred account-name field. Supply this or one of the legacy name fields below.' },
                name: { type: 'string', minLength: 2, maxLength: 100, description: 'Legacy alias for the account name.' },
                accountName: { type: 'string', minLength: 2, maxLength: 100, description: 'Legacy alias for the account name.' },
              },
              anyOf: [{ required: ['displayName'] }, { required: ['name'] }, { required: ['accountName'] }],
            },
            example: { upiId: 'yourname@okaxis', displayName: 'Hemanth' },
          } },
        },
        responses: {
          '200': { description: 'Saved UPI ID and user-provided account name; verification status remains UNVERIFIED_FORMAT_ONLY' },
          '400': { description: 'Invalid UPI ID or account name, or no account name supplied' },
          '401': { description: 'Authentication required' },
        },
      },
      delete: { security: [{ bearerAuth: [] }], summary: 'Remove the signed-in user UPI ID', responses: { '200': { description: 'UPI ID removed' } } },
    },
    '/users/me/bank-accounts': {
      get: { security: [{ bearerAuth: [] }], summary: 'List own masked bank accounts; verification remains unavailable without an authorized provider', responses: { '200': { description: 'Masked bank account list' } } },
      post: { security: [{ bearerAuth: [] }], summary: 'Save a bank account encrypted at rest; this does not verify ownership or enable payouts', responses: { '201': { description: 'Bank account saved with UNVERIFIED status' }, '503': { description: 'Encrypted storage key is not configured' } } },
    },
    '/users/me/bank-accounts/{id}': {
      patch: { security: [{ bearerAuth: [] }], summary: 'Update own bank-account holder, bank name, or IFSC; resets verification status', responses: { '200': { description: 'Updated unverified account' }, '404': { description: 'Account not found' } } },
      delete: { security: [{ bearerAuth: [] }], summary: 'Remove own saved bank account', responses: { '200': { description: 'Account removed' }, '404': { description: 'Account not found' } } },
    },
    '/users/me/bank-accounts/{id}/verify': { post: { security: [{ bearerAuth: [] }], summary: 'Request authorized ownership verification; currently unavailable and leaves account unverified', responses: { '503': { description: 'BANK_ACCOUNT_VERIFICATION_UNAVAILABLE' } } } },
    '/users/me/balance': { get: { security: [{ bearerAuth: [] }], summary: 'Get ledger-derived balances in paise', responses: { '200': { description: 'INR balances' } } } },
    '/users/me/transactions': { get: { security: [{ bearerAuth: [] }], summary: 'Get ledger history', responses: { '200': { description: 'Transaction rows' } } } },
    '/users/me/referrals': { get: { security: [{ bearerAuth: [] }], summary: 'Get own referral code and privacy-masked team members', responses: { '200': { description: 'Referral counts and members' } } } },
    '/wallet-methods': { get: { security: [{ bearerAuth: [] }], summary: 'Read payment-method eligibility', responses: { '200': { description: 'Method configuration' } } } },
    '/wallet-references': { get: { security: [{ bearerAuth: [] }], summary: 'Read saved wallet references; these are not provider connections', responses: { '200': { description: 'Saved references' } } }, post: { security: [{ bearerAuth: [] }], summary: 'Save a UPI reference without connecting the account', responses: { '201': { description: 'Reference saved' } } } },
      '/deposits': { get: { security: [{ bearerAuth: [] }], summary: 'List own deposits and manual-claim state', responses: { '200': { description: 'Deposit list' } } }, post: { security: [{ bearerAuth: [] }], summary: 'Create a pending UPI request only when an explicit recipient is configured; or use Cashfree sandbox when enabled', parameters: [{ in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string' } }], responses: { '201': { description: 'Pending UPI deposit with explicitly configured receiver VPA or optional Cashfree sandbox payment session; no wallet funds are credited at creation' }, '503': { description: 'UPI recipient or payment provider is unavailable; no request is created when UPI recipient configuration is missing' } } } },
    '/deposits/{id}/manual-verification': { post: { security: [{ bearerAuth: [] }], summary: 'Submit a required transaction image and optional 12-digit UTR/RRN as an unverified manual-review claim; this never marks the deposit paid', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['evidenceImageBase64', 'evidenceMimeType'], properties: { transactionReference: { type: 'string', pattern: '^\\d{12}$', description: 'Optional UTR/RRN' }, evidenceImageBase64: { type: 'string', description: 'JPEG/PNG/WebP base64, maximum decoded size 1.5 MB' }, evidenceMimeType: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp'] } } } } } }, responses: { '202': { description: 'Claim queued for authorized Finance review; deposit stays pending' }, '400': { description: 'Optional UTR format or screenshot validation failed' }, '404': { description: 'Deposit not found or not owned by the signed-in user' }, '409': { description: 'Deposit is not eligible for manual review' }, '429': { description: 'Rate limited' } } } },
    '/deposits/{id}': { get: { security: [{ bearerAuth: [] }], summary: 'Read own deposit request', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deposit' }, '404': { description: 'Not found' } } } },
    '/orders': { get: { security: [{ bearerAuth: [] }], summary: 'List eligible available orders', responses: { '200': { description: 'Order list' } } }, post: { security: [{ bearerAuth: [] }], summary: 'Create a Sell listing', responses: { '201': { description: 'Listing created' } } } },
    '/orders/{id}/reservations': { post: { security: [{ bearerAuth: [] }], summary: 'Atomically reserve an available order', responses: { '200': { description: 'Order reserved; payment not verified' }, '409': { description: 'Already unavailable' } } } },
    '/withdrawals': { get: { security: [{ bearerAuth: [] }], summary: 'List own withdrawal requests and P2P offers', responses: { '200': { description: 'Own withdrawal history; sensitive payee details are omitted' } } }, post: { security: [{ bearerAuth: [] }], summary: 'Create a P2P withdrawal offer and reserve wallet funds; this is not a bank payout', parameters: [{ in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string' } }], responses: { '201': { description: 'Open offer created with an auditable balance reservation' }, '400': { description: 'Amount must be at least ₹100 and divisible by ₹100' }, '409': { description: 'Insufficient available balance or account limit reached' }, '503': { description: 'P2P offer creation is unavailable' } } } },
    '/withdrawals/marketplace': { get: { security: [{ bearerAuth: [] }], summary: 'List open, unexpired offers from other verified users without payment details', responses: { '200': { description: 'Eligible marketplace offers; real-money payment verification is currently unavailable' } } } },
    '/withdrawals/offers/{id}/cancel': { post: { security: [{ bearerAuth: [] }], summary: 'Cancel own unmatched offer and release its reserved funds', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Offer cancelled and reservation released' }, '404': { description: 'Offer not found or not owned by caller' }, '409': { description: 'Offer is already matched' } } } },
    '/deposits/quick-match': { post: { security: [{ bearerAuth: [] }], summary: 'Atomically match an exact amount with the oldest eligible offer from another user', parameters: [{ in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Existing idempotent match returned' }, '201': { description: 'Matched order created; no wallet credit occurs at match time' }, '404': { description: 'No exact eligible offer is available' }, '409': { description: 'Idempotency key conflicts with another amount' } } } },
    '/deposits/orders/my': { get: { security: [{ bearerAuth: [] }], summary: 'List the signed-in buyer’s P2P deposit orders', responses: { '200': { description: 'Own P2P order history' } } } },
    '/deposits/orders/{id}': { get: { security: [{ bearerAuth: [] }], summary: 'Read an owned P2P order and reveal matched payee details only after confirmation', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Owned order details' }, '404': { description: 'Order not found or not owned by caller' } } } },
    '/deposits/orders/{id}/confirm': { post: { security: [{ bearerAuth: [] }], summary: 'Confirm a matched order before showing the seller’s authorized UPI details', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Order confirmed; payment remains pending independent verification' }, '404': { description: 'Order not found or not owned by caller' }, '409': { description: 'Order cannot be confirmed in its current state' } } } },
    '/deposits/orders/{id}/payment-reference': { post: { security: [{ bearerAuth: [] }], summary: 'Submit an optional UPI transaction reference as an unverified review claim; it never credits a wallet', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '202': { description: 'Claim queued for independent Finance review; order remains unverified' }, '404': { description: 'Order not found or not owned by caller' }, '409': { description: 'Order is not eligible for a payment claim or a claim is already pending' } } } },
    '/deposits/orders/{id}/cancel': { post: { security: [{ bearerAuth: [] }], summary: 'Cancel an eligible unpaid order and release seller reservation according to dispute rules', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Order cancelled and eligible reservation released' }, '404': { description: 'Order not found or not owned by caller' }, '409': { description: 'Payment dispute or verified state prevents cancellation' } } } },
    '/orders/{id}/dispute': { post: { security: [{ bearerAuth: [] }], summary: 'Create a dispute for an owned matched payment; disputed reservations remain held for review', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '201': { description: 'Dispute opened for Finance review' }, '404': { description: 'Order not found or not owned by caller' }, '409': { description: 'Order is not eligible for a dispute' } } } },
    '/admin/p2p/offers': { get: { security: [{ bearerAuth: [] }], summary: 'Search and paginate P2P withdrawal offers (Operations/Admin)', parameters: [{ in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } }, { in: 'query', name: 'pageSize', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }, { in: 'query', name: 'q', schema: { type: 'string', maxLength: 120 } }, { in: 'query', name: 'status', schema: { type: 'string', maxLength: 40 } }], responses: { '200': { description: 'Paginated offer records for authorized operations users' }, '403': { description: 'Operations/Admin role required' } } } },
    '/admin/p2p/offers/{id}/cancel': { post: { security: [{ bearerAuth: [] }], summary: 'Cancel an eligible invalid P2P offer with an audited reason', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Offer cancelled and eligible reservation released' }, '403': { description: 'Operations/Admin role required' }, '409': { description: 'Offer cannot be cancelled in its current state' } } } },
    '/admin/p2p/orders': { get: { security: [{ bearerAuth: [] }], summary: 'Search and paginate P2P orders by order reference, offer reference, or status', parameters: [{ in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } }, { in: 'query', name: 'pageSize', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }, { in: 'query', name: 'q', schema: { type: 'string', maxLength: 120 } }, { in: 'query', name: 'status', schema: { type: 'string', maxLength: 40 } }], responses: { '200': { description: 'Paginated order records for authorized operations users' }, '403': { description: 'Operations/Admin role required' } } } },
    '/admin/p2p/claims': { get: { security: [{ bearerAuth: [] }], summary: 'List pending payment claims for Finance review', parameters: [{ in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } }, { in: 'query', name: 'pageSize', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }], responses: { '200': { description: 'Paginated claims for authorized Finance reviewers' }, '403': { description: 'Finance/Admin role required' } } } },
    '/admin/p2p/claims/{id}/review': { post: { security: [{ bearerAuth: [] }], summary: 'Approve or reject a claim after independent bank/provider reconciliation; approval writes the balanced ledger transaction', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Decision and audit event recorded' }, '403': { description: 'Finance/Admin role required' }, '409': { description: 'Evidence does not match or claim was already reviewed' } } } },
    '/support/tickets': { get: { security: [{ bearerAuth: [] }], summary: 'List own support tickets', responses: { '200': { description: 'Ticket list' } } }, post: { security: [{ bearerAuth: [] }], summary: 'Create support ticket', responses: { '201': { description: 'Ticket created' } } } },
    '/notifications': { get: { security: [{ bearerAuth: [] }], summary: 'List own notifications', responses: { '200': { description: 'Notification list' } } } },
    '/webhooks/payments/{provider}': { post: { summary: 'Cashfree webhook; signature is checked and payment is re-queried server-side before deposit status changes', parameters: [{ in: 'path', name: 'provider', required: true, schema: { type: 'string', enum: ['cashfree'] } }], responses: { '200': { description: 'Authenticated event received' }, '401': { description: 'Invalid signature' }, '503': { description: 'Event could not be processed; retry later' } } } },
    '/admin/overview': { get: { security: [{ bearerAuth: [] }], summary: 'Minimal admin overview; admin user provisioning is not yet available', responses: { '200': { description: 'Counts' }, '403': { description: 'Admin role required' } } } },
    '/admin/reconciliation/claims': { get: { security: [{ bearerAuth: [] }], summary: 'List paginated manual payment claims for an authorized Finance/Admin reviewer', parameters: [{ in: 'query', name: 'status', schema: { type: 'string', enum: ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED'], default: 'PENDING_REVIEW' } }, { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } }, { in: 'query', name: 'pageSize', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }], responses: { '200': { description: 'Paginated claims with masked customer identifiers' }, '403': { description: 'Finance/Admin role required' } } } },
    '/admin/reconciliation/claims/{claimId}/evidence': { get: { security: [{ bearerAuth: [] }], summary: 'Download customer-submitted payment screenshot for an authorized Finance/Admin reviewer', parameters: [{ in: 'path', name: 'claimId', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Private image evidence; this is not payment proof' }, '403': { description: 'Finance/Admin role required' }, '404': { description: 'No screenshot is attached' } } } },
    '/admin/reconciliation/claims/{claimId}/review': { post: { security: [{ bearerAuth: [] }], summary: 'Approve or reject a manual claim; approval requires independently verified reference, exact INR amount, receiver receipt, and evidence reference', parameters: [{ in: 'path', name: 'claimId', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Review recorded; approved receipt creates one balanced ledger transaction' }, '403': { description: 'Finance/Admin role required' }, '409': { description: 'Already reviewed, duplicate transaction, or mismatched evidence' }, '429': { description: 'Rate limited' } } } },
    '/admin/notifications': {
      get: { security: [{ bearerAuth: [] }], summary: 'List recent in-app notifications (Admin/Super Admin)', responses: { '200': { description: 'Paginated in-app notices; no SMS or push delivery state' }, '403': { description: 'Admin permission required' } } },
      post: { security: [{ bearerAuth: [] }], summary: 'Create an audited in-app announcement for active users or selected users', responses: { '201': { description: 'In-app notifications created and audit logged' }, '400': { description: 'Invalid target or missing broad-send confirmation' }, '403': { description: 'Admin permission required' } } },
    },
    '/admin/reward-rules': { get: { security: [{ bearerAuth: [] }], summary: 'Read reward rules; payout funding may be unavailable', responses: { '200': { description: 'Reward configuration and funding state' }, '403': { description: 'Finance/Admin permission required' } } } },
    '/admin/reward-rules/{id}': { patch: { security: [{ bearerAuth: [] }], summary: 'Update reward eligibility configuration (Super Admin only); does not credit rewards', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Audited rule update' }, '403': { description: 'Super Admin permission required' }, '404': { description: 'Reward rule not found' } } } },
    '/admin/support/tickets/{id}': { get: { security: [{ bearerAuth: [] }], summary: 'Read a support ticket and its messages with masked user details', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Ticket and message thread' }, '403': { description: 'Support/Operations permission required' }, '404': { description: 'Ticket not found' } } } },
    '/admin/support/tickets/{id}/reply': { post: { security: [{ bearerAuth: [] }], summary: 'Reply to an open ticket; stores an in-app user notice and audit event', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '201': { description: 'Reply stored and user notified in-app' }, '403': { description: 'Support/Operations permission required' }, '409': { description: 'Ticket is closed' } } } },
    '/admin/support/tickets/{id}/status': { patch: { security: [{ bearerAuth: [] }], summary: 'Change support ticket status with an audit reason', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Audited ticket status change' }, '403': { description: 'Support/Operations permission required' }, '409': { description: 'Ticket is closed' } } } },
    '/auth/logout': { post: { summary: 'Revoke the current access-token session, or revoke by refresh token when the access token is unavailable', requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { refreshToken: { type: 'string', minLength: 20, maxLength: 200 } }, additionalProperties: true }, example: { refreshToken: 'opaque-refresh-token-value' } } } }, responses: { '204': { description: 'Session revoked; response has no body' }, '400': { description: 'Invalid refresh token shape' } } } },
    '/users/me/vip': { get: { summary: 'Read configured VIP progress and ledger-backed rewards', responses: { '200': { description: 'VIP levels, volume and reward policy' } } } },
    '/deposits/{id}/cancel': { post: { summary: 'Cancel an owned UPI deposit request that has no pending payment claim', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Cancelled or expired deposit state' }, '404': { description: 'Deposit not found' }, '409': { description: 'Deposit has a payment claim or is no longer cancellable' } } } },
    '/deposits/orders/{id}/handoff-attempt': { post: { summary: 'Record the mobile UPI-app handoff attempt; this is not payment verification', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['outcome'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['OPENED', 'UNAVAILABLE'] } } }, example: { outcome: 'OPENED' } } } }, responses: { '202': { description: 'Handoff attempt recorded; payment remains unverified' }, '404': { description: 'Order not found or not owned by caller' }, '409': { description: 'Handoff is not available in the current state' } } } },
    '/admin/p2p/claims/{claimId}': { get: { summary: 'Read a payment claim and its order timeline for Finance review', parameters: [{ in: 'path', name: 'claimId', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Claim and masked account details' }, '403': { description: 'Finance/Admin role required' }, '404': { description: 'Claim not found' } } } },
    '/admin/p2p/claims/{claimId}/evidence': { get: { summary: 'Read private buyer-submitted payment image evidence', parameters: [{ in: 'path', name: 'claimId', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Private image evidence; not independent proof of payment' }, '403': { description: 'Finance/Admin role required' }, '404': { description: 'Evidence not found' } } } },
    '/orders/{id}': { get: { summary: 'Read an available order or an order belonging to the caller', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Order and status history' }, '404': { description: 'Order not found or not visible to caller' } } } },
    '/orders/{id}/cancel': { post: { summary: 'Cancel own available, unexpired legacy sell order', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Order marked cancelled' }, '409': { description: 'Only an available unexpired order can be cancelled' } } } },
    '/orders/{id}/payment-submission': { post: { summary: 'Legacy payment-submission endpoint; disabled because no approved payment integration is configured', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '503': { description: 'Payment verification unavailable; no payment is marked successful' } } } },
    '/support/tickets/{id}': { get: { summary: 'Read one of the signed-in user’s support tickets and messages', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Ticket and messages' }, '404': { description: 'Ticket not found or not owned by caller' } } } },
    '/admin/me': { get: { summary: 'Read the authenticated administrator role, allowed sections, and read-only financial-operation gate state', responses: { '200': { description: 'Admin identity, role-based section list, and financialOperationsEnabled capability flag. This flag is informational; mutation routes enforce the server-side gate.' }, '403': { description: 'Admin account required' } } } },
    '/admin/push-devices': {
      post: { summary: 'Register an Expo push token for the authenticated administrator', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['expoPushToken', 'platform'], additionalProperties: false, properties: { expoPushToken: { type: 'string', pattern: '^(Expo|Exponent)PushToken\\[[A-Za-z0-9_-]+\\]$', minLength: 20, maxLength: 255 }, platform: { type: 'string', enum: ['android', 'ios'] } } }, example: { expoPushToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]', platform: 'android' } } } }, responses: { '201': { description: 'Device registered' }, '400': { description: 'Invalid push-token data' }, '403': { description: 'Administrator account required' } } },
      delete: { summary: 'Revoke a push token owned by the authenticated administrator', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['expoPushToken'], additionalProperties: false, properties: { expoPushToken: { type: 'string', pattern: '^(Expo|Exponent)PushToken\\[[A-Za-z0-9_-]+\\]$', minLength: 20, maxLength: 255 } } }, example: { expoPushToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' } } } }, responses: { '200': { description: 'Whether a matching device was revoked' }, '400': { description: 'Invalid push-token data' }, '403': { description: 'Administrator account required' } } },
    },
    '/admin/push-events': { get: { summary: 'List paginated durable admin push events for Finance/Admin reviewers', parameters: [{ in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } }, { in: 'query', name: 'pageSize', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } }], responses: { '200': { description: 'Events and delivery summary' }, '403': { description: 'Finance/Admin role required' } } } },
    '/admin/users': { get: { summary: 'Search and paginate users with masked phone and ledger-derived wallet summaries', parameters: [{ in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } }, { in: 'query', name: 'pageSize', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }, { in: 'query', name: 'q', schema: { type: 'string', maxLength: 120 } }, { in: 'query', name: 'status', schema: { type: 'string', enum: ['PENDING_PROFILE', 'ACTIVE', 'SUSPENDED', 'CLOSED'] } }], responses: { '200': { description: 'Paginated user results' }, '403': { description: 'Finance/Operations role required' } } } },
    '/admin/users/{id}': { get: { summary: 'Read masked user profile, ledger-derived wallet balances, and recent ledger transactions for authorized reviewers', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'User detail, current available and reserved balances, and recent ledger entries' }, '403': { description: 'Finance/Operations role required' }, '404': { description: 'User not found' } } } },
    '/admin/users/{id}/wallet/credits': { get: { summary: 'List pending, decided, and posted Super Admin wallet credit requests and ledger records for one user', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }, { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } }, { in: 'query', name: 'pageSize', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }], responses: { '200': { description: 'Paginated maker-checker requests, immutable credit ledger transactions, and audit records' }, '403': { description: 'Super Admin role required' }, '404': { description: 'User not found' } } } },
    '/admin/users/{id}/wallet/credit': { post: { summary: 'Retired direct-credit endpoint; all credits require a separate maker-checker request', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '403': { description: 'SUPER_ADMIN role required' }, '409': { description: 'Direct credits are retired; submit an independent-approval request instead. No balance changes.' } } } },
    '/admin/wallet/credits/requests': {
      get: { summary: 'List SUPER_ADMIN credit requests; filters by status with pagination', parameters: [{ in: 'query', name: 'status', schema: { type: 'string', enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'] } }, { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } }, { in: 'query', name: 'pageSize', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }], responses: { '200': { description: 'Credit request queue and metadata' }, '403': { description: 'SUPER_ADMIN role required' } } },
      post: { summary: 'Create a pending credit request after revalidating the selected identity and balance; this does not change a balance', parameters: [{ in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['targetUserId', 'verifiedPublicId', 'verifiedPhoneMasked', 'verifiedWalletBalancePaise', 'amountPaise', 'reason'], additionalProperties: false, properties: { targetUserId: { type: 'string', format: 'uuid' }, verifiedPublicId: { type: 'string', minLength: 1, maxLength: 50 }, verifiedPhoneMasked: { type: 'string', minLength: 4, maxLength: 32 }, verifiedWalletBalancePaise: { type: 'integer', minimum: 0 }, amountPaise: { type: 'integer', minimum: 10000, maximum: 1000000 }, reason: { type: 'string', minLength: 8, maxLength: 500 } } } } } }, responses: { '201': { description: 'Pending request recorded with audit trail; no ledger posting' }, '403': { description: 'SUPER_ADMIN role required' }, '409': { description: 'Target identity or balance changed, target unavailable, or idempotency conflict' }, '503': { description: 'Financial workflow disabled' } } },
    },
    '/admin/wallet/credits/direct': { post: { summary: 'Post a direct wallet credit only on the explicitly identified staging service when its dedicated flag, ledger readiness, and cleared adjustment funding are verified', parameters: [{ in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['targetUserId', 'verifiedPublicId', 'verifiedPhoneMasked', 'verifiedWalletBalancePaise', 'amountPaise', 'reason'], additionalProperties: false, properties: { targetUserId: { type: 'string', format: 'uuid' }, verifiedPublicId: { type: 'string', minLength: 1, maxLength: 50 }, verifiedPhoneMasked: { type: 'string', minLength: 4, maxLength: 32 }, verifiedWalletBalancePaise: { type: 'integer', minimum: 0 }, amountPaise: { type: 'integer', minimum: 10000, maximum: 1000000 }, reason: { type: 'string', minLength: 8, maxLength: 500 } } } } } }, responses: { '200': { description: 'Matching prior direct staging credit returned without duplicate posting' }, '201': { description: 'Funded wallet credit, balanced ledger entries, and audit records atomically committed' }, '403': { description: 'Active SUPER_ADMIN role required' }, '404': { description: 'Direct credit route unavailable outside the explicitly identified staging service' }, '409': { description: 'Target changed, idempotency key conflict, or adjustment funding insufficient' }, '503': { description: 'Direct staging credit disabled or ledger/funding readiness blocked' } } } },
    '/admin/wallet/credits/requests/{id}/decision': { post: { summary: 'Approve or reject a pending credit as a different active SUPER_ADMIN; approval posts atomically only within funded balance', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['decision', 'reason'], additionalProperties: false, properties: { decision: { type: 'string', enum: ['APPROVE', 'REJECT'] }, reason: { type: 'string', minLength: 8, maxLength: 500 } } } } } }, responses: { '200': { description: 'Decision, ledger and audit result' }, '403': { description: 'Maker cannot check; active SUPER_ADMIN required' }, '404': { description: 'Request not found' }, '409': { description: 'Request decided, target unavailable or fund insufficient' }, '503': { description: 'Financial workflow disabled' } } } },
    '/admin/wallet/funding/requests': {
      get: { summary: 'List funding evidence requests by status', parameters: [{ in: 'query', name: 'status', schema: { type: 'string', enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'] } }, { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } }, { in: 'query', name: 'pageSize', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }], responses: { '200': { description: 'Funding requests with hashed bank references' }, '403': { description: 'SUPER_ADMIN role required' } } },
      post: { summary: 'Submit actual cleared bank receipt evidence; the bank reference is hashed and no ledger balance changes until checker approval', parameters: [{ in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['amountPaise', 'sourceAccountLabel', 'externalReference', 'evidenceReference', 'evidenceSha256', 'statementDate', 'reason'], additionalProperties: false, properties: { amountPaise: { type: 'integer', minimum: 1 }, sourceAccountLabel: { type: 'string', maxLength: 100 }, externalReference: { type: 'string', minLength: 6, maxLength: 200, writeOnly: true }, evidenceReference: { type: 'string', maxLength: 160 }, evidenceSha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' }, statementDate: { type: 'string', format: 'date' }, reason: { type: 'string', minLength: 8, maxLength: 500 } } } } } }, responses: { '201': { description: 'Evidence request submitted, no balance posted' }, '403': { description: 'SUPER_ADMIN role required' }, '409': { description: 'Reference or idempotency key already used' }, '503': { description: 'Funding workflow disabled' } } },
    },
    '/admin/wallet/funding/requests/{id}/decision': { post: { summary: 'Approve or reject funding evidence; approval requires an independent cleared-funds attestation and posts a balanced cash-to-adjustment-fund journal', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['decision', 'reason'], additionalProperties: false, properties: { decision: { type: 'string', enum: ['APPROVE', 'REJECT'] }, reason: { type: 'string', minLength: 8, maxLength: 500 }, evidenceVerified: { type: 'boolean', default: false } } } } } }, responses: { '200': { description: 'Decision, accounting journal and audit result' }, '403': { description: 'Maker cannot check; active SUPER_ADMIN required' }, '409': { description: 'Evidence not attested or request already decided' }, '503': { description: 'Funding workflow or account unavailable' } } } },
    '/admin/wallet/reconciliation': { get: { summary: 'Read-only reconciliation of adjustment fund and settlement cash ledger balances, debit/credit totals, and request counts', responses: { '200': { description: 'Ledger reconciliation totals' }, '403': { description: 'SUPER_ADMIN role required' } } } },
    '/admin/users/{id}/status': { post: { summary: 'Suspend or reactivate a user with an audited reason', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status', 'reason'], additionalProperties: false, properties: { status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED'] }, reason: { type: 'string', minLength: 8, maxLength: 500 } } }, example: { status: 'SUSPENDED', reason: 'Account requires a security review.' } } } }, responses: { '200': { description: 'Updated user status and audit entry' }, '403': { description: 'Operations role required' }, '404': { description: 'User not found' } } } },
    '/admin/deposits': { get: { summary: 'List and filter deposit requests for authorized Finance or Operations reviewers', responses: { '200': { description: 'Deposit records and pagination metadata' }, '403': { description: 'Finance/Operations role required' } } } },
    '/admin/withdrawals': { get: { summary: 'List withdrawal requests and P2P offers for authorized reviewers', responses: { '200': { description: 'Withdrawal and offer records' }, '403': { description: 'Finance/Operations role required' } } } },
    '/admin/transactions': { get: { summary: 'Search transaction records for Finance/Admin reviewers', responses: { '200': { description: 'Transaction records' }, '403': { description: 'Finance/Admin role required' } } } },
    '/admin/wallets/ledger': { get: { summary: 'Inspect wallet ledger entries for Finance/Admin reviewers', responses: { '200': { description: 'Ledger rows with integer paise amounts' }, '403': { description: 'Finance/Admin role required' } } } },
    '/admin/wallet-adjustments': { post: { summary: 'Apply an idempotent, audited single-admin wallet adjustment from the separately funded adjustment account; disabled by default and also protected by the financial-operations gate', parameters: [{ in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Matching prior adjustment returned without duplicate ledger entries' }, '201': { description: 'Adjustment and audit record atomically committed' }, '400': { description: 'Invalid amount, reason, target ID, or idempotency key' }, '403': { description: 'Only the explicitly configured ADMIN account is permitted' }, '404': { description: 'User not found' }, '409': { description: 'Insufficient funded source/available balance or idempotency conflict' }, '503': { description: 'Adjustment feature, financial-operations gate, or adjustment funding account is unavailable' } } } },
    '/admin/referrals': { get: { summary: 'List referral relationships with pagination and commission policy', responses: { '200': { description: 'Referral records and policy' }, '403': { description: 'Operations role required' } } } },
    '/admin/referrals/config': {
      get: { summary: 'Read referral commission rates and milestone settings', responses: { '200': { description: 'Referral policy and milestone rules' }, '403': { description: 'Operations role required' } } },
      patch: { summary: 'Change direct and indirect commission rates with an audit reason', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['directRateBps', 'indirectRateBps', 'reason'], additionalProperties: false, properties: { directRateBps: { type: 'integer', minimum: 0, maximum: 1000 }, indirectRateBps: { type: 'integer', minimum: 0, maximum: 1000 }, reason: { type: 'string', minLength: 8, maxLength: 500 } } }, example: { directRateBps: 40, indirectRateBps: 10, reason: 'Approved referral rate update.' } } } }, responses: { '200': { description: 'Updated commission configuration' }, '403': { description: 'Admin/Super Admin role required' } } },
    },
    '/admin/referrals/milestones/{key}': { patch: { summary: 'Update a configured referral milestone with an audit reason', parameters: [{ in: 'path', name: 'key', required: true, schema: { type: 'string', enum: ['TIER_5', 'TIER_10', 'TIER_20'] } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['requiredReferrals', 'qualifyingTopUpPaise', 'rewardAmountPaise', 'enabled', 'reason'], additionalProperties: false, properties: { requiredReferrals: { type: 'integer', minimum: 1, maximum: 100000 }, qualifyingTopUpPaise: { type: 'integer', minimum: 1, nullable: true }, rewardAmountPaise: { type: 'integer', minimum: 0 }, enabled: { type: 'boolean' }, reason: { type: 'string', minLength: 8, maxLength: 500 } } }, example: { requiredReferrals: 5, qualifyingTopUpPaise: 2000000, rewardAmountPaise: 200000, enabled: true, reason: 'Approved milestone rule review.' } } } }, responses: { '200': { description: 'Updated milestone rule; payout funding is not implied' }, '403': { description: 'Admin/Super Admin role required' } } } },
    '/admin/commissions': { get: { summary: 'List commission ledger rows and configured rates', responses: { '200': { description: 'Paginated commission records and totals' }, '403': { description: 'Finance/Admin role required' } } } },
    '/admin/providers': { get: { summary: 'Read payment-provider availability and fail-closed configuration state', responses: { '200': { description: 'Configured methods and provider availability' }, '403': { description: 'Operations role required' } } } },
    '/admin/audit-logs': { get: { summary: 'Search and paginate immutable admin audit records', parameters: [{ in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } }, { in: 'query', name: 'pageSize', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } }, { in: 'query', name: 'q', schema: { type: 'string', maxLength: 120 } }], responses: { '200': { description: 'Audit log entries' }, '403': { description: 'Operations role required' } } } },
    '/admin/system-health': { get: { summary: 'Read API, database and provider health indicators without secret configuration values', responses: { '200': { description: 'Health status, dependency latency and worker availability' } } } },
    '/admin/reports': { get: { summary: 'Read aggregate operational reports without user-level identifiers; financial reports require the server financial-operations gate', parameters: [
      { in: 'query', name: 'report', required: true, schema: { type: 'string', enum: ['registrations', 'deposits', 'withdrawals', 'p2p-orders', 'support-tickets'] } },
      { in: 'query', name: 'from', required: true, schema: { type: 'string', format: 'date' } },
      { in: 'query', name: 'to', required: true, schema: { type: 'string', format: 'date' } },
      { in: 'query', name: 'status', required: false, schema: { type: 'string' } },
    ], responses: { '200': { description: 'Daily and status aggregates for the selected date range' }, '400': { description: 'Invalid report kind, date range, or status filter' }, '403': { description: 'Admin or Super Admin role required' }, '503': { description: 'Financial operations are disabled; financial reports are unavailable' } } } },
    '/admin/settings': { get: { summary: 'Read safe system configuration flags; secrets and mutation controls are excluded', responses: { '200': { description: 'Read-only environment and feature availability summary' }, '403': { description: 'Admin or Super Admin role required' } } } },
    '/admin/p2p/overview': { get: { summary: 'Read P2P offer/order status counts and pending claims', responses: { '200': { description: 'P2P status counts' }, '403': { description: 'Finance/Admin role required' } } } },
    '/admin/disputes': { get: { summary: 'Search and paginate P2P and legacy order disputes; this endpoint is view-only', parameters: [{ in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } }, { in: 'query', name: 'pageSize', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }, { in: 'query', name: 'q', schema: { type: 'string', maxLength: 120 } }, { in: 'query', name: 'status', schema: { type: 'string', enum: ['DISPUTED'] } }], responses: { '200': { description: 'Paginated filtered disputes; resolution workflow is not implemented' }, '403': { description: 'Finance/Admin role required' } } } },
    '/admin/support/tickets': { get: { summary: 'Search and paginate user support tickets', responses: { '200': { description: 'Support tickets with masked user identifiers' }, '403': { description: 'Operations role required' } } } },
    '/admin/admins': { get: { summary: 'Search and paginate provisioned administrators with masked phone numbers; role changes are not implemented here', parameters: [{ in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } }, { in: 'query', name: 'pageSize', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }, { in: 'query', name: 'q', schema: { type: 'string', maxLength: 120 } }], responses: { '200': { description: 'Paginated provisioned admin records' }, '403': { description: 'Super Admin role required' } } } },
  },
} as const;

type OpenApiResponse = { description: string; content?: Record<string, { schema: Record<string, unknown> }> };
type OpenApiOperation = {
  security?: Array<Record<string, string[]>>;
  requestBody?: unknown;
  responses: Record<string, OpenApiResponse>;
  parameters?: unknown[];
  summary?: string;
};
type MutableOpenApi = {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: { schemas: Record<string, unknown> };
};

const requestBodies: Record<string, unknown> = {
  'post /auth/logout': { required: false, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, properties: { refreshToken: { type: 'string', minLength: 20, maxLength: 200 } } }, example: { refreshToken: 'opaque-refresh-token-value' } } } },
  'post /auth/register/request-otp': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['phoneE164', 'fullName'], additionalProperties: false, properties: { phoneE164: { type: 'string', pattern: '^\\+[1-9]\\d{7,14}' }, fullName: { type: 'string', minLength: 2, maxLength: 80 }, referralCode: { type: 'string', minLength: 4, maxLength: 60, pattern: '^[A-Za-z0-9_-]+$' } } }, example: { phoneE164: '+919876543210', fullName: 'Hemanth', referralCode: 'REFCODE123' } } } },
  'post /auth/register/verify-otp': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['challengeId', 'phoneE164', 'fullName', 'password', 'code'], additionalProperties: false, properties: { challengeId: { type: 'string', format: 'uuid' }, phoneE164: { type: 'string', pattern: '^\\+[1-9]\\d{7,14}' }, fullName: { type: 'string', minLength: 2, maxLength: 80 }, password: { type: 'string', minLength: 8, maxLength: 128, format: 'password' }, code: { type: 'string', pattern: '^\\d{6}$' }, referralCode: { type: 'string', minLength: 4, maxLength: 60, pattern: '^[A-Za-z0-9_-]+$' } } }, example: { challengeId: '00000000-0000-4000-8000-000000000001', phoneE164: '+919876543210', fullName: 'Hemanth', password: 'ReplaceWithSecurePassword1!', code: '123456' } } } },
  'post /auth/forgot-password/request-otp': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['phoneE164'], additionalProperties: false, properties: { phoneE164: { type: 'string', pattern: '^\\+[1-9]\\d{7,14}' } } }, example: { phoneE164: '+919876543210' } } } },
  'post /auth/password/login': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['phoneE164', 'password'], additionalProperties: false, properties: { phoneE164: { type: 'string', pattern: '^\\+[1-9]\\d{7,14}' }, password: { type: 'string', minLength: 1, maxLength: 128, format: 'password' } } }, example: { phoneE164: '+919876543210', password: 'YourPassword' } } } },
  'post /auth/password/reset': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['phoneE164', 'challengeId', 'code', 'newPassword'], additionalProperties: false, properties: { phoneE164: { type: 'string', pattern: '^\\+[1-9]\\d{7,14}' }, challengeId: { type: 'string', format: 'uuid' }, code: { type: 'string', pattern: '^\\d{6}$' }, newPassword: { type: 'string', minLength: 8, maxLength: 128, format: 'password' } } }, example: { phoneE164: '+919876543210', challengeId: '00000000-0000-4000-8000-000000000001', code: '123456', newPassword: 'ReplaceWithSecurePassword1!' } } } },
  'post /auth/refresh': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string', minLength: 20, maxLength: 200 } } }, example: { refreshToken: 'opaque-refresh-token-value' } } } },
  'post /admin/auth/login': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['phoneE164', 'password'], additionalProperties: false, properties: { phoneE164: { type: 'string', pattern: '^\\+[1-9]\\d{7,14}' }, password: { type: 'string', minLength: 1, maxLength: 128, format: 'password' } } }, example: { phoneE164: '+919876543210', password: 'AdminPassword' } } } },
  'post /admin/auth/forgot-password/request-otp': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['phoneE164'], additionalProperties: false, properties: { phoneE164: { type: 'string', pattern: '^\\+[1-9]\\d{7,14}$' } } }, example: { phoneE164: '+919876543210' } } } },
  'post /admin/auth/password/reset': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['phoneE164', 'challengeId', 'code', 'newPassword'], additionalProperties: false, properties: { phoneE164: { type: 'string', pattern: '^\\+[1-9]\\d{7,14}$' }, challengeId: { type: 'string', format: 'uuid' }, code: { type: 'string', pattern: '^\\d{6}$' }, newPassword: { type: 'string', minLength: 12, maxLength: 128, format: 'password' } } }, example: { phoneE164: '+919876543210', challengeId: '00000000-0000-4000-8000-000000000001', code: '123456', newPassword: 'ReplaceWithSecureAdminPassword1!' } } } },
  'post /users/me/bank-accounts': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['accountHolderName', 'accountNumber', 'confirmAccountNumber', 'ifsc'], additionalProperties: false, properties: { accountHolderName: { type: 'string', minLength: 2, maxLength: 100 }, accountNumber: { type: 'string', pattern: '^\\d{8,20}$' }, confirmAccountNumber: { type: 'string', pattern: '^\\d{8,20}$' }, ifsc: { type: 'string', pattern: '^[A-Z]{4}0[A-Z0-9]{6}$' }, bankName: { type: 'string', minLength: 2, maxLength: 100 } } }, example: { accountHolderName: 'Account Holder', accountNumber: '123456789012', confirmAccountNumber: '123456789012', ifsc: 'ABCD0123456', bankName: 'Example Bank' } } } },
  'patch /users/me/bank-accounts/{id}': { required: true, content: { 'application/json': { schema: { type: 'object', minProperties: 1, additionalProperties: false, properties: { accountHolderName: { type: 'string', minLength: 2, maxLength: 100 }, bankName: { type: 'string', minLength: 2, maxLength: 100, nullable: true }, ifsc: { type: 'string', pattern: '^[A-Z]{4}0[A-Z0-9]{6}$' } } }, example: { accountHolderName: 'Account Holder', ifsc: 'ABCD0123456' } } } },
  'post /wallet-references': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['method', 'reference'], additionalProperties: false, properties: { method: { type: 'string', enum: ['Paytm', 'PhonePe', 'Navi'] }, reference: { type: 'string', maxLength: 120, pattern: '^[\\w.\\-]+@[\\w.\\-]+$' } } }, example: { method: 'Paytm', reference: 'yourname@paytm' } } } },
  'post /deposits': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['amountPaise', 'method'], additionalProperties: false, properties: { amountPaise: { type: 'integer', minimum: 1, description: 'INR amount in integer paise.' }, method: { type: 'string', enum: ['UPI', 'Paytm', 'PhonePe', 'Navi', 'Cashfree'] } } }, example: { amountPaise: 10000, method: 'UPI' } } } },
  'post /deposits/{id}/manual-verification': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['evidenceImageBase64', 'evidenceMimeType'], additionalProperties: false, properties: { transactionReference: { type: 'string', pattern: '^\\d{12}$', description: 'Optional 12-digit UTR/RRN.' }, evidenceImageBase64: { type: 'string', minLength: 1, description: 'JPEG/PNG/WebP base64 image (maximum decoded size 1.5 MB).' }, evidenceMimeType: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp'] } } }, example: { transactionReference: '123456789012', evidenceImageBase64: 'BASE64_IMAGE_DATA', evidenceMimeType: 'image/png' } } } },
  'post /admin/reconciliation/claims/{claimId}/review': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['decision', 'reason', 'evidenceReference'], additionalProperties: false, properties: { decision: { type: 'string', enum: ['APPROVE', 'REJECT'] }, reason: { type: 'string', minLength: 8, maxLength: 500 }, evidenceReference: { type: 'string', minLength: 3, maxLength: 160 }, verifiedTransactionReference: { type: 'string' }, verifiedAmountPaise: { type: 'integer', minimum: 1 }, verifiedCurrency: { type: 'string', enum: ['INR'] }, receiverConfirmed: { type: 'boolean' } }, description: 'APPROVE additionally requires verifiedTransactionReference, verifiedAmountPaise, verifiedCurrency=INR, and receiverConfirmed=true. REJECT requires reason and evidenceReference.' }, example: { decision: 'REJECT', reason: 'Recipient-side records show no matching receipt.', evidenceReference: 'FINANCE-CASE-REFERENCE' } } } },
  'post /orders': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['kind', 'amountPaise', 'method'], additionalProperties: false, properties: { kind: { type: 'string', enum: ['SELL'] }, amountPaise: { type: 'integer', minimum: 1000, maximum: 100000000 }, method: { type: 'string', enum: ['Paytm', 'PhonePe', 'Navi'] } } }, example: { kind: 'SELL', amountPaise: 10000, method: 'Paytm' } } } },
  'post /orders/{id}/reservations': { required: false, content: { 'application/json': { schema: { type: 'object', additionalProperties: false }, example: {} } }, description: 'The handler accepts an omitted body or an empty JSON object; send Idempotency-Key.' },
  'post /withdrawals': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['amountPaise'], additionalProperties: false, properties: { amountPaise: { type: 'integer', minimum: 10000, maximum: 100000000, multipleOf: 10000, description: 'Integer paise; ₹100 increments.' } } }, example: { amountPaise: 50000 } } } },
  'post /deposits/quick-match': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['amountPaise'], additionalProperties: false, properties: { amountPaise: { type: 'integer', minimum: 10000, maximum: 1000000, multipleOf: 10000 }, withdrawalOfferId: { type: 'string', format: 'uuid' }, excludeWithdrawalOfferId: { type: 'string', format: 'uuid' } } }, example: { amountPaise: 10000 } } } },
  'post /deposits/orders/{id}/confirm': { required: false, content: { 'application/json': { schema: { type: 'object', additionalProperties: false }, example: {} } } },
  'post /deposits/orders/{id}/handoff-attempt': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['outcome'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['OPENED', 'UNAVAILABLE'] } } }, example: { outcome: 'OPENED' } } } },
  'post /deposits/orders/{id}/payment-reference': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['evidenceImageBase64', 'evidenceMimeType', 'claimedAmountPaise', 'claimedPaidAt'], additionalProperties: false, properties: { transactionReference: { type: 'string', minLength: 4, maxLength: 120, pattern: '^[A-Za-z0-9._/-]+$' }, evidenceImageBase64: { type: 'string', minLength: 16, maxLength: 1900000, description: 'JPEG or PNG base64, decoded size at most 1.4 MB.' }, evidenceMimeType: { type: 'string', enum: ['image/jpeg', 'image/png'] }, claimedAmountPaise: { type: 'integer', minimum: 1, maximum: 100000000 }, claimedPaidAt: { type: 'string', format: 'date-time' } } }, example: { transactionReference: 'UPI-REFERENCE-1234', evidenceImageBase64: 'BASE64_PNG_DATA', evidenceMimeType: 'image/png', claimedAmountPaise: 10000, claimedPaidAt: '2026-11-03T10:00:00Z' } } } },
  'post /orders/{id}/dispute': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 8, maxLength: 500 } } }, example: { reason: 'The payment status does not match the receipt.' } } } },
  'post /admin/p2p/offers/{id}/cancel': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 8, maxLength: 500 } } }, example: { reason: 'Offer requires an operations investigation.' } } } },
  'post /admin/p2p/claims/{id}/review': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['decision', 'reason', 'evidenceReference'], additionalProperties: false, properties: { decision: { type: 'string', enum: ['APPROVE', 'REJECT'] }, reason: { type: 'string', minLength: 8, maxLength: 500 }, evidenceReference: { type: 'string', minLength: 3, maxLength: 160 }, verifiedTransactionReference: { type: 'string', minLength: 4, maxLength: 120, pattern: '^[A-Za-z0-9._/-]+$' }, verifiedAmountPaise: { type: 'integer', minimum: 1 }, verifiedCurrency: { type: 'string', minLength: 3, maxLength: 3 }, verifiedPayeeVpa: { type: 'string', minLength: 3, maxLength: 100 }, receiverConfirmed: { type: 'boolean' }, paymentNotReceivedConfirmed: { type: 'boolean' } }, description: 'APPROVE requires all verified transaction, amount, INR currency, payee, and receiver-confirmation fields. REJECT requires paymentNotReceivedConfirmed=true before reservation release.' }, example: { decision: 'REJECT', reason: 'Recipient-side records show no receipt.', evidenceReference: 'FINANCE-CASE-REFERENCE', paymentNotReceivedConfirmed: true } } } },
  'post /support/tickets': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['subject', 'message'], additionalProperties: false, properties: { subject: { type: 'string', minLength: 1, maxLength: 100 }, message: { type: 'string', minLength: 1, maxLength: 2000 } } }, example: { subject: 'Deposit status question', message: 'Please help me understand the current order status.' } } } },
  'post /admin/support/tickets/{id}/reply': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['message', 'reason'], additionalProperties: false, properties: { message: { type: 'string', minLength: 2, maxLength: 2000 }, reason: { type: 'string', minLength: 8, maxLength: 500 } } }, example: { message: 'We are reviewing your support request.', reason: 'Responding to the user’s documented support request.' } } } },
  'post /admin/wallet-adjustments': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['targetPublicId', 'direction', 'amountPaise', 'reason'], additionalProperties: false, properties: { targetPublicId: { type: 'string', minLength: 1, maxLength: 10, pattern: '^[A-Za-z0-9_-]+$' }, direction: { type: 'string', enum: ['CREDIT', 'DEBIT'] }, amountPaise: { type: 'integer', minimum: 1, maximum: 1000000, description: 'INR amount in integer paise; maximum ₹10,000.00 per adjustment.' }, reason: { type: 'string', minLength: 8, maxLength: 500 } } }, example: { targetPublicId: '123456789', direction: 'CREDIT', amountPaise: 10000, reason: 'Approved manual wallet correction.' } } } },
  'post /admin/push-devices': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['expoPushToken', 'platform'], additionalProperties: false, properties: { expoPushToken: { type: 'string', minLength: 20, maxLength: 255, pattern: '^(Expo|Exponent)PushToken\\[[A-Za-z0-9_-]+\\]$' }, platform: { type: 'string', enum: ['android', 'ios'] } } }, example: { expoPushToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]', platform: 'android' } } } },
  'delete /admin/push-devices': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['expoPushToken'], additionalProperties: false, properties: { expoPushToken: { type: 'string', minLength: 20, maxLength: 255, pattern: '^(Expo|Exponent)PushToken\\[[A-Za-z0-9_-]+\\]$' } } }, example: { expoPushToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' } } } },
  'patch /admin/support/tickets/{id}/status': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status', 'reason'], additionalProperties: false, properties: { status: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED'] }, reason: { type: 'string', minLength: 8, maxLength: 500 } } }, example: { status: 'IN_PROGRESS', reason: 'Support team has started investigating.' } } } },
  'post /admin/notifications': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['title', 'body', 'audience', 'reason'], additionalProperties: false, properties: { title: { type: 'string', minLength: 3, maxLength: 100 }, body: { type: 'string', minLength: 3, maxLength: 1000 }, audience: { type: 'string', enum: ['ALL_ACTIVE', 'USER_IDS'] }, userIds: { type: 'array', maxItems: 1000, items: { type: 'string', format: 'uuid' } }, confirmAll: { type: 'boolean' }, reason: { type: 'string', minLength: 8, maxLength: 500 } }, description: 'ALL_ACTIVE requires confirmAll=true. USER_IDS requires 1-1000 active user IDs.' }, example: { title: 'Scheduled maintenance', body: 'The service will be briefly unavailable.', audience: 'ALL_ACTIVE', confirmAll: true, reason: 'Approved user service announcement.' } } } },
  'patch /admin/reward-rules/{id}': { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'eligibility', 'amountPaise', 'fundingSource', 'enabled', 'reason'], additionalProperties: false, properties: { name: { type: 'string', minLength: 2, maxLength: 100 }, eligibility: { type: 'object', additionalProperties: true }, amountPaise: { type: 'integer', minimum: 0, maximum: 100000000000 }, fundingSource: { type: 'string', maxLength: 100, nullable: true }, enabled: { type: 'boolean' }, reason: { type: 'string', minLength: 8, maxLength: 500 } } }, example: { name: 'Configured milestone reward', eligibility: {}, amountPaise: 0, fundingSource: null, enabled: false, reason: 'Approved reward configuration review.' } } } },
};

// Top-level JSON response fields below are taken from the corresponding route
// handlers. Nested Prisma projections remain open objects because their exact
// selected columns differ by route and are documented by the route's select.
const responseFields: Record<string, string[]> = {
  'get /config': ['currency', 'financialOperations', 'upiDeposit', 'livePaymentsEnabled', 'sandboxPaymentsEnabled', 'availabilityMessage', 'methods'],
  'post /auth/request-otp': ['challengeId', 'expiresInSeconds', 'resendAfterSeconds', 'deliveryState', 'gatewayStatus', 'message'],
  'get /auth/otp-status/{challengeId}': ['challengeId', 'deliveryState', 'gatewayStatus', 'statusAvailable', 'message'],
  'post /auth/verify-otp': ['accessToken', 'refreshToken', 'accessExpiresInSeconds', 'user', 'welcomeBonus'],
  'post /auth/register/request-otp': ['challengeId', 'expiresInSeconds', 'resendAfterSeconds', 'deliveryState', 'gatewayStatus', 'message'],
  'post /auth/register/verify-otp': ['ok', 'user', 'message', 'welcomeBonus'],
  'post /auth/forgot-password/request-otp': ['challengeId', 'expiresInSeconds', 'resendAfterSeconds', 'message'],
  'post /auth/password/login': ['accessToken', 'refreshToken', 'accessExpiresInSeconds', 'user', 'welcomeBonus', 'demoOnly'],
  'post /auth/password/reset': ['ok', 'message'],
  'post /auth/refresh': ['accessToken', 'refreshToken', 'accessExpiresInSeconds'],
  'post /admin/auth/login': ['accessToken', 'refreshToken', 'accessExpiresInSeconds', 'user', 'role'],
  'post /admin/auth/forgot-password/request-otp': ['challengeId', 'expiresInSeconds', 'resendAfterSeconds', 'message'],
  'post /admin/auth/password/reset': ['ok', 'message'],
  'get /users/me': ['user'],
  'patch /users/me': ['user'],
  'get /users/me/upi': ['upiId', 'displayName', 'detailsStatus', 'verificationStatus', 'message'],
  'patch /users/me/upi': ['upiId', 'displayName', 'detailsStatus', 'verificationStatus', 'message'],
  'delete /users/me/upi': ['upiId', 'displayName', 'detailsStatus', 'verificationStatus'],
  'get /users/me/bank-accounts': ['bankAccounts', 'ownershipVerificationAvailable', 'message'],
  'post /users/me/bank-accounts': ['bankAccount', 'message'],
  'patch /users/me/bank-accounts/{id}': ['bankAccount', 'message'],
  'delete /users/me/bank-accounts/{id}': ['ok', 'message'],
  'get /users/me/balance': ['currency', 'availablePaise', 'pendingPaise', 'reservedPaise', 'withdrawalPendingPaise', 'rewardProfitPaise', 'authoritative'],
  'get /users/me/transactions': ['currency', 'transactions'],
  'get /users/me/referrals': ['referralCode', 'referralLink', 'period', 'directCount', 'indirectCount', 'totalMembers', 'todayNewMembers', 'todayDirectMembers', 'todayIndirectMembers', 'periodVerifiedDepositsPaise', 'todayVerifiedDepositsPaise', 'periodVerifiedDepositCount', 'todayVerifiedDepositCount', 'totalVerifiedDepositCount', 'totalVerifiedDepositsPaise', 'totalEarningsPaise', 'todayEarningsPaise', 'periodEarningsPaise', 'directEarningsPaise', 'indirectEarningsPaise', 'earnedCommissionPaise', 'pendingCommissionPaise', 'accruedCommissionPaise', 'commissionPercentBps', 'commissionRates', 'commissionBasis', 'commissionRuleConfigured', 'fundedProgram', 'payoutRulesConfigured', 'rewardFundingMessage', 'milestones', 'commissionHistory', 'members'],
  'get /users/me/vip': ['programStatus', 'currentLevel', 'activeLevels', 'levels', 'volume', 'rewardPolicy'],
  'get /wallet-methods': ['currency', 'financialOperations', 'upiDeposit', 'livePaymentsEnabled', 'sandboxPaymentsEnabled', 'availabilityMessage', 'methods', 'walletActivation'],
  'get /wallet-references': ['wallets'],
  'post /wallet-references': ['wallet', 'message'],
  'get /deposits': ['currency', 'deposits'],
  'post /deposits': ['deposit', 'paymentStarted', 'checkout', 'receiverVpa', 'message'],
  'post /deposits/{id}/manual-verification': ['claim', 'deposit', 'message'],
  'get /deposits/{id}': ['deposit'],
  'get /orders': ['currency', 'orders'],
  'post /orders': ['order', 'demoOnly', 'message'],
  'post /orders/{id}/reservations': ['message', 'order', 'demoOnly'],
  'get /orders/{id}': ['order'],
  'post /orders/{id}/cancel': ['id', 'status'],
  'get /withdrawals': ['serverTime', 'withdrawals', 'offers'],
  'post /withdrawals': ['withdrawalOffer', 'message'],
  'get /withdrawals/marketplace': ['currency', 'offers', 'paymentVerificationAvailable', 'message'],
  'post /withdrawals/offers/{id}/cancel': ['offer', 'message'],
  'post /deposits/quick-match': ['serverTime', 'order', 'withdrawalOffer', 'reward', 'message'],
  'get /deposits/orders/my': ['serverTime', 'orders'],
  'get /deposits/orders/{id}': ['serverTime', 'order'],
  'post /deposits/orders/{id}/confirm': ['serverTime', 'order', 'paymentDetails', 'message'],
  'post /deposits/orders/{id}/handoff-attempt': ['order', 'paymentConfirmed', 'message'],
  'post /deposits/orders/{id}/payment-reference': ['claim', 'order', 'message'],
  'post /deposits/orders/{id}/cancel': ['order', 'message'],
  'post /deposits/{id}/cancel': ['deposit', 'message'],
  'post /orders/{id}/dispute': ['order', 'message'],
  'get /admin/p2p/offers': ['offers', 'page', 'pageSize', 'total'],
  'post /admin/p2p/offers/{id}/cancel': ['offer', 'message'],
  'get /admin/p2p/orders': ['orders', 'page', 'pageSize', 'total'],
  'get /admin/p2p/claims': ['claims', 'page', 'pageSize', 'total'],
  'get /admin/p2p/claims/{claimId}': ['claim'],
  'post /admin/p2p/claims/{id}/review': ['claim', 'orderStatus', 'offerStatus', 'rematchableAmountPaise', 'credited', 'rewardPaise', 'referralCommissionPaise', 'referralCommissionStatus', 'message'],
  'get /support/tickets': ['tickets'],
  'post /support/tickets': ['ticket', 'messages'],
  'get /support/tickets/{id}': ['ticket'],
  'get /notifications': ['notifications'],
  'post /webhooks/payments/{provider}': ['received'],
  'get /admin/overview': ['users', 'deposits', 'withdrawals', 'disputedOrders', 'currency', 'metrics', 'charts', 'recentTransactions', 'recentUsers', 'pendingAdminActions', 'system'],
  'get /admin/reconciliation/claims': ['claims', 'total', 'page', 'pageSize'],
  'post /admin/reconciliation/claims/{claimId}/review': ['claim', 'deposit', 'rewardAmountPaise', 'ledgerTransactionId'],
  'get /admin/notifications': ['notifications', 'total', 'page', 'pageSize', 'delivery'],
  'post /admin/notifications': ['recipientCount', 'delivery'],
  'get /admin/reward-rules': ['rules', 'payoutFundingConfigured'],
  'patch /admin/reward-rules/{id}': ['rule', 'payoutFundingConfigured'],
  'get /admin/support/tickets/{id}': ['ticket'],
  'post /admin/support/tickets/{id}/reply': ['message', 'status'],
  'post /admin/wallet-adjustments': ['adjustment', 'message'],
  'patch /admin/support/tickets/{id}/status': ['ticket'],
  'get /admin/me': ['userId', 'role', 'allowedSections', 'financialOperationsEnabled', 'walletAdjustmentAllowed', 'walletAdjustmentsEnabled', 'walletCreditsAllowed', 'adminWalletFundingEnabled', 'adminWalletCreditsEnabled', 'adminWalletProductionApproved', 'adminWalletExternalReconciliationVerified', 'walletCreditsEnabled', 'walletCreditRequestsEnabled', 'walletFundingRequestsEnabled', 'walletCreditBlockers', 'walletFundingBlockers', 'stagingDirectWalletCreditsEnabled', 'stagingDirectWalletCreditBlockers'],
  'get /admin/wallet/credits/requests': ['requests', 'total', 'page', 'pageSize'],
  'post /admin/wallet/credits/requests': ['request', 'replayed', 'message'],
  'post /admin/wallet/credits/direct': ['credit', 'replayed', 'balancePaise', 'message'],
  'post /admin/wallet/credits/requests/{id}/decision': ['request', 'credit', 'message'],
  'get /admin/wallet/funding/requests': ['requests', 'total', 'page', 'pageSize'],
  'post /admin/wallet/funding/requests': ['request', 'replayed', 'message'],
  'post /admin/wallet/funding/requests/{id}/decision': ['request', 'ledgerTransactionId', 'message'],
  'get /admin/wallet/reconciliation': ['accounts', 'ledgerBalanced', 'totalDebitsPaise', 'totalCreditsPaise', 'pendingCredits', 'pendingFunding', 'approvedCredits', 'approvedFunding', 'creditLedgerDiscrepancies', 'fundingLedgerDiscrepancies', 'requestLedgerLinksReconciled', 'walletCreditBlockers', 'operationsEnabled'],
  'post /admin/push-devices': ['device', 'message'],
  'delete /admin/push-devices': ['revoked'],
  'get /admin/push-events': ['events', 'total', 'page', 'pageSize'],
  'get /admin/users': ['users', 'page', 'pageSize', 'total'],
  'get /admin/users/{id}': ['user'],
  'get /admin/users/{id}/wallet/credits': ['credits', 'auditLogs', 'requests', 'requestTotal', 'total', 'page', 'pageSize'],
  'post /admin/users/{id}/status': ['user'],
  'get /admin/deposits': ['deposits', 'page', 'pageSize', 'total'],
  'get /admin/withdrawals': ['withdrawals', 'page', 'pageSize', 'total', 'payoutIntegration'],
  'get /admin/transactions': ['transactions', 'page', 'pageSize', 'total'],
  'get /admin/wallets/ledger': ['entries', 'total', 'page', 'pageSize'],
  'get /admin/referrals': ['referrals', 'total', 'page', 'pageSize', 'commissionPolicy'],
  'get /admin/referrals/config': ['config', 'milestones', 'payoutFundingConfigured'],
  'patch /admin/referrals/config': ['config', 'payoutFundingConfigured'],
  'patch /admin/referrals/milestones/{key}': ['milestone', 'payoutFundingConfigured'],
  'get /admin/commissions': ['commissions', 'total', 'totalCommissionPaise', 'page', 'pageSize', 'configuration'],
  'get /admin/providers': ['currency', 'upiDeposit', 'livePaymentsEnabled', 'sandboxPaymentsEnabled', 'availabilityMessage', 'methods'],
  'get /admin/audit-logs': ['auditLogs', 'total', 'page', 'pageSize'],
  'get /admin/system-health': ['checkedAt', 'api', 'database', 'databaseResponseTimeMs', 'payments', 'payoutProvider', 'backgroundWorkers'],
  'get /admin/reports': ['report', 'from', 'to', 'statusFilter', 'total', 'totalAmountPaise', 'statusBreakdown', 'daily'],
  'get /admin/settings': ['environment', 'financialOperationsEnabled', 'paymentProvider', 'otpProvider', 'databaseConfigured', 'financialSafety', 'editableSettings', 'message'],
  'get /admin/p2p/overview': ['offers', 'orders', 'pendingClaims'],
  'get /admin/disputes': ['disputes', 'total', 'page', 'pageSize', 'message'],
  'get /admin/support/tickets': ['tickets', 'total', 'page', 'pageSize', 'actions'],
  'get /admin/admins': ['admins', 'management', 'total', 'page', 'pageSize'],
};

const stringResponseFields = new Set(['id', 'challengeId', 'currency', 'availabilityMessage', 'message', 'status', 'statusFilter', 'detailsStatus', 'verificationStatus', 'deliveryState', 'gatewayStatus', 'rewardPolicy', 'period', 'reference', 'displayDescription', 'paymentMethod', 'ownershipStatus', 'payoutIntegration', 'delivery', 'management', 'actions', 'api', 'database', 'payoutProvider', 'backgroundWorkers', 'referralLink', 'orderStatus', 'offerStatus', 'referralCommissionStatus', 'role', 'accessToken', 'refreshToken', 'receiverVpa', 'phoneMasked', 'displayName', 'phoneE164', 'upiId', 'evidenceMimeType', 'transactionReference', 'method', 'name', 'reason', 'type', 'referenceId', 'environment', 'referralCode', 'commissionBasis', 'rewardFundingMessage', 'report', 'from', 'to', 'otpProvider', 'paymentProvider', 'totalAmountPaise', 'totalDebitsPaise', 'totalCreditsPaise']);
const booleanResponseFields = new Set(['livePaymentsEnabled', 'sandboxPaymentsEnabled', 'paymentVerificationAvailable', 'authoritative', 'ok', 'paymentStarted', 'demoOnly', 'paymentConfirmed', 'received', 'revoked', 'credited', 'payoutFundingConfigured', 'statusAvailable', 'ownershipVerificationAvailable', 'commissionRuleConfigured', 'fundedProgram', 'payoutRulesConfigured', 'financialOperationsEnabled', 'walletAdjustmentAllowed', 'walletAdjustmentsEnabled', 'walletCreditsAllowed', 'adminWalletFundingEnabled', 'adminWalletCreditsEnabled', 'adminWalletProductionApproved', 'adminWalletExternalReconciliationVerified', 'walletCreditsEnabled', 'walletCreditRequestsEnabled', 'walletFundingRequestsEnabled', 'stagingDirectWalletCreditsEnabled', 'databaseConfigured', 'ledgerBalanced', 'operationsEnabled', 'replayed', 'requestLedgerLinksReconciled']);
const arrayResponseFields = new Set(['methods', 'wallets', 'bankAccounts', 'transactions', 'deposits', 'orders', 'withdrawals', 'offers', 'tickets', 'messages', 'notifications', 'claims', 'rules', 'events', 'users', 'entries', 'referrals', 'milestones', 'commissions', 'payments', 'disputes', 'allowedSections', 'levels', 'recentTransactions', 'recentUsers', 'members', 'commissionHistory', 'auditLogs', 'admins', 'credits', 'recentLedgerEntries', 'daily', 'statusBreakdown', 'editableSettings', 'requests', 'accounts', 'walletCreditBlockers', 'walletFundingBlockers', 'stagingDirectWalletCreditBlockers']);
const numericArrayResponseFields = new Set<string>();
const dateResponseFields = new Set(['serverTime', 'checkedAt']);
const objectResponseFields = new Set(['financialOperations', 'upiDeposit', 'walletActivation', 'user', 'bankAccount', 'wallet', 'deposit', 'order', 'withdrawalOffer', 'offer', 'reward', 'paymentDetails', 'claim', 'ticket', 'metrics', 'charts', 'pendingAdminActions', 'system', 'config', 'milestone', 'commissionPolicy', 'configuration', 'device', 'adjustment', 'credit', 'request', 'financialSafety']);
const nullableResponseFields = new Set(['upiId', 'displayName', 'receiverVpa', 'databaseResponseTimeMs', 'statusFilter', 'ledgerTransactionId']);
const integerResponseFields = new Set(['expiresInSeconds', 'accessExpiresInSeconds', 'resendAfterSeconds', 'databaseResponseTimeMs', 'todayNewMembers', 'todayDirectMembers', 'todayIndirectMembers', 'totalMembers', 'directCount', 'indirectCount', 'recipientCount', 'users', 'deposits', 'withdrawals', 'disputedOrders', 'pendingClaims', 'activeLevels', 'pendingCredits', 'pendingFunding', 'approvedCredits', 'approvedFunding', 'creditLedgerDiscrepancies', 'fundingLedgerDiscrepancies']);
const responseTypeOverrides: Record<string, Record<string, Record<string, unknown>>> = {
  'get /admin/me': { walletCreditBlockers: { type: 'array', items: { type: 'string' } }, walletFundingBlockers: { type: 'array', items: { type: 'string' } }, stagingDirectWalletCreditBlockers: { type: 'array', items: { type: 'string' } } },
  'get /admin/wallet/reconciliation': { walletCreditBlockers: { type: 'array', items: { type: 'string' } } },
  'get /admin/overview': Object.fromEntries(['users', 'deposits', 'withdrawals', 'disputedOrders'].map((name) => [name, { type: 'integer' }])),
  'get /admin/p2p/overview': { offers: { type: 'object', additionalProperties: { type: 'integer' } }, orders: { type: 'object', additionalProperties: { type: 'integer' } }, pendingClaims: { type: 'integer' } },
  'get /users/me/referrals': Object.fromEntries(['todayNewMembers', 'todayDirectMembers', 'todayIndirectMembers', 'totalMembers', 'directCount', 'indirectCount', 'periodVerifiedDepositCount', 'todayVerifiedDepositCount', 'totalVerifiedDepositCount'].map((name) => [name, { type: 'integer' }])),
  'post /admin/support/tickets/{id}/reply': { message: { type: 'object', additionalProperties: true } },
  'post /admin/wallet/credits/requests/{id}/decision': { credit: { type: 'object', nullable: true, additionalProperties: true } },
  'post /admin/wallet/credits/direct': { credit: { type: 'object', additionalProperties: true } },
};

const objectSchema = (properties: Record<string, Record<string, unknown>>, required: string[] = []) => ({
  type: 'object', additionalProperties: false, ...(required.length ? { required } : {}), properties,
});
const stringField = { type: 'string' };
const nullableStringField = { type: 'string', nullable: true };
const integerField = { type: 'integer' };
const nullableIntegerField = { type: 'integer', nullable: true };
const booleanField = { type: 'boolean' };
const dateField = { type: 'string', format: 'date-time' };
const nullableDateField = { type: 'string', format: 'date-time', nullable: true };
const arrayOf = (items: Record<string, unknown>) => ({ type: 'array', items });
const p2pClaimSummarySchema = objectSchema({ status: stringField, transactionReference: nullableStringField, reviewReason: nullableStringField, createdAt: dateField, claimedAmountPaise: nullableIntegerField, claimedPaidAt: nullableDateField, evidenceAttached: booleanField }, ['status', 'createdAt', 'claimedAmountPaise', 'claimedPaidAt', 'evidenceAttached']);
const userMaskedSchema = objectSchema({ id: stringField, publicId: nullableStringField, displayName: nullableStringField, phoneMasked: stringField });
const p2pOrderTimestampSchema = objectSchema({ orderCreatedAt: dateField, matchedAt: dateField, payNowClickedAt: nullableDateField, paymentDetailsViewedAt: nullableDateField, paymentHandoffInitiatedAt: nullableDateField, expiresAt: nullableDateField, cancellationRequestedAt: nullableDateField, paymentSubmittedAt: nullableDateField, reservationReleasedAt: nullableDateField, paymentVerifiedAt: nullableDateField, financeResolvedAt: nullableDateField }, ['orderCreatedAt', 'matchedAt']);
const p2pTimelineEventSchema = objectSchema({ target: stringField, action: stringField, createdAt: dateField, reason: nullableStringField });
const adminP2pOrderTimelineEventSchema = objectSchema({ id: stringField, actorId: nullableStringField, action: stringField, target: stringField, reason: nullableStringField, metadata: { type: 'object', additionalProperties: true }, createdAt: dateField });
const p2pRewardPreviewSchema = objectSchema({ percentBps: integerField, estimatedPaise: integerField, enabled: booleanField, status: stringField, message: stringField, creditedPaise: integerField });
const p2pOrderSchema = objectSchema({ id: stringField, referenceId: stringField, buyerUserId: stringField, sellerUserId: stringField, withdrawalOfferId: stringField, amountPaise: integerField, currency: stringField, status: stringField, idempotencyKey: stringField, providerReference: nullableStringField, expiresAt: nullableDateField, paymentDetailsShownAt: nullableDateField, paymentHandoffStartedAt: nullableDateField, cancellationRequestedAt: nullableDateField, createdAt: dateField, updatedAt: dateField, viewerRole: stringField, withdrawalOffer: objectSchema({ id: stringField, referenceId: stringField, paymentMethod: stringField }), timestamps: p2pOrderTimestampSchema, reward: p2pRewardPreviewSchema, claims: arrayOf(p2pClaimSummarySchema), buyer: objectSchema({ publicId: nullableStringField, phoneMasked: stringField }), verificationStatus: stringField, handoffStatus: stringField }, ['id', 'referenceId', 'buyerUserId', 'sellerUserId', 'withdrawalOfferId', 'amountPaise', 'currency', 'status', 'idempotencyKey', 'createdAt', 'updatedAt']);
const p2pAdminOrderSchema = objectSchema({ id: stringField, referenceId: stringField, buyerUserId: stringField, sellerUserId: stringField, withdrawalOfferId: stringField, amountPaise: integerField, currency: stringField, status: stringField, idempotencyKey: stringField, providerReference: nullableStringField, expiresAt: nullableDateField, paymentDetailsShownAt: nullableDateField, paymentHandoffStartedAt: nullableDateField, cancellationRequestedAt: nullableDateField, createdAt: dateField, updatedAt: dateField, buyer: userMaskedSchema, seller: userMaskedSchema, withdrawalOffer: objectSchema({ id: stringField, referenceId: stringField, status: stringField, paymentMethod: stringField, amountPaise: integerField, createdAt: dateField, expiresAt: dateField }), claims: arrayOf(objectSchema({ status: stringField, transactionReference: nullableStringField, reviewReason: nullableStringField, evidenceReference: nullableStringField, verifiedAmountPaise: nullableIntegerField, verifiedCurrency: nullableStringField, receiverConfirmed: booleanField, reviewedAt: nullableDateField, createdAt: dateField })), timeline: arrayOf(adminP2pOrderTimelineEventSchema) }, ['id', 'referenceId', 'buyerUserId', 'sellerUserId', 'withdrawalOfferId', 'amountPaise', 'currency', 'status', 'idempotencyKey', 'createdAt', 'updatedAt', 'buyer', 'seller', 'withdrawalOffer', 'claims', 'timeline']);
const p2pAdminOfferSchema = objectSchema({ id: stringField, referenceId: stringField, userId: stringField, amountPaise: integerField, currency: stringField, paymentMethod: stringField, payeeName: nullableStringField, status: stringField, expiresAt: dateField, idempotencyKey: stringField, matchedBuyerId: nullableStringField, createdAt: dateField, updatedAt: dateField, completedAmountPaise: integerField, activeReservedPaise: integerField, disputedHeldPaise: integerField, matchedAmountPaise: integerField, remainingAmountPaise: integerField, availableAmountPaise: integerField, orderCount: integerField, user: objectSchema({ id: stringField, publicId: nullableStringField, displayName: nullableStringField, phoneMasked: stringField }), orders: arrayOf(objectSchema({ id: stringField, referenceId: stringField, buyerUserId: stringField, sellerUserId: stringField, withdrawalOfferId: stringField, amountPaise: integerField, currency: stringField, status: stringField, idempotencyKey: stringField, providerReference: nullableStringField, expiresAt: nullableDateField, paymentDetailsShownAt: nullableDateField, paymentHandoffStartedAt: nullableDateField, cancellationRequestedAt: nullableDateField, createdAt: dateField, updatedAt: dateField, buyer: stringField, verificationStatus: stringField, handoffStatus: stringField, claims: arrayOf(objectSchema({ status: stringField, createdAt: dateField, reviewReason: nullableStringField, evidenceReference: nullableStringField })) })) });
const paymentClaimSchema = objectSchema({ id: stringField, depositId: stringField, userId: stringField, transactionReference: nullableStringField, status: stringField, reviewedByUserId: nullableStringField, reviewReason: nullableStringField, evidenceReference: nullableStringField, evidenceMimeType: nullableStringField, verifiedAmountPaise: nullableIntegerField, verifiedCurrency: nullableStringField, receiverConfirmed: booleanField, reviewedAt: nullableDateField, createdAt: dateField, updatedAt: dateField });
const depositSchema = objectSchema({ id: stringField, userId: stringField, amountPaise: integerField, currency: stringField, method: stringField, status: stringField, merchantReference: stringField, idempotencyKey: stringField, providerReference: nullableStringField, paymentSessionId: nullableStringField, expiresAt: nullableDateField, ledgerTransactionId: nullableStringField, createdAt: dateField, updatedAt: dateField, methodDisplay: stringField, receiverVpa: stringField, manualPaymentClaim: { ...objectSchema({ status: stringField, createdAt: dateField, reviewedAt: nullableDateField, reviewReason: nullableStringField }), nullable: true }, paymentStarted: booleanField, manualVerificationAvailable: booleanField, automaticVerificationAvailable: booleanField });
const legacyOrderSchema = objectSchema({ id: stringField, kind: stringField, sellerId: stringField, buyerId: nullableStringField, amountPaise: integerField, currency: stringField, method: stringField, status: stringField, expiresAt: dateField, idempotencyKey: nullableStringField, createdAt: dateField, updatedAt: dateField, history: arrayOf(objectSchema({ id: stringField, orderId: stringField, status: stringField, actorId: nullableStringField, reason: nullableStringField, createdAt: dateField })) });
const p2pOfferSchema = objectSchema({ id: stringField, referenceId: stringField, userId: stringField, amountPaise: integerField, currency: stringField, paymentMethod: stringField, payeeName: nullableStringField, status: stringField, expiresAt: dateField, idempotencyKey: stringField, matchedBuyerId: nullableStringField, createdAt: dateField, updatedAt: dateField, payeeVerificationStatus: stringField, completedAmountPaise: integerField, activeReservedPaise: integerField, disputedHeldPaise: integerField, sellerFundsReservedPaise: integerField, matchedAmountPaise: integerField, remainingAmountPaise: integerField, availableAmountPaise: integerField, orders: arrayOf(p2pOrderSchema), user: userMaskedSchema });
const adminP2pClaimListItemSchema = objectSchema({ id: stringField, orderId: stringField, userId: stringField, transactionReference: nullableStringField, status: stringField, claimedAmountPaise: nullableIntegerField, claimedPaidAt: nullableDateField, evidenceMimeType: nullableStringField, evidenceReference: nullableStringField, reviewReason: nullableStringField, createdAt: dateField, evidenceAttached: booleanField, user: userMaskedSchema, order: objectSchema({ id: stringField, referenceId: stringField, amountPaise: integerField, status: stringField, createdAt: dateField, expiresAt: nullableDateField, paymentDetailsShownAt: nullableDateField, paymentHandoffStartedAt: nullableDateField, cancellationRequestedAt: nullableDateField, seller: objectSchema({ id: stringField, publicId: nullableStringField }), withdrawalOffer: objectSchema({ id: stringField, referenceId: stringField, payeeVpa: stringField, payeeName: nullableStringField }), timestamps: p2pOrderTimestampSchema, timeline: arrayOf(p2pTimelineEventSchema) }) }, ['id', 'orderId', 'userId', 'status', 'claimedAmountPaise', 'claimedPaidAt', 'createdAt', 'evidenceAttached', 'user', 'order']);
const adminP2pClaimDetailSchema = objectSchema({ id: stringField, status: stringField, transactionReference: nullableStringField, claimedAmountPaise: nullableIntegerField, claimedPaidAt: nullableDateField, evidenceMimeType: nullableStringField, createdAt: dateField, reviewReason: nullableStringField, evidenceAttached: booleanField, user: objectSchema({ id: stringField, publicId: nullableStringField, displayName: nullableStringField, phoneMasked: stringField }), order: objectSchema({ id: stringField, referenceId: stringField, buyerUserId: stringField, sellerUserId: stringField, amountPaise: integerField, currency: stringField, status: stringField, createdAt: dateField, expiresAt: nullableDateField, paymentDetailsShownAt: nullableDateField, paymentHandoffStartedAt: nullableDateField, cancellationRequestedAt: nullableDateField, seller: objectSchema({ id: stringField, publicId: nullableStringField }), withdrawalOffer: objectSchema({ id: stringField, referenceId: stringField, payeeVpa: stringField, payeeName: nullableStringField }), timestamps: p2pOrderTimestampSchema, timeline: arrayOf(p2pTimelineEventSchema) }) }, ['id', 'status', 'claimedAmountPaise', 'claimedPaidAt', 'createdAt', 'evidenceAttached', 'user', 'order']);
const miniAdminUserSchema = { ...objectSchema({ publicId: nullableStringField, displayName: nullableStringField }), nullable: true };
const financialOperationsSchema = objectSchema({
  enabled: booleanField,
  gateEnabled: booleanField,
  status: { type: 'string', enum: ['AVAILABLE', 'UNAVAILABLE'] },
  reason: nullableStringField,
  blockers: arrayOf(stringField),
  capabilities: objectSchema({
    addMoney: objectSchema({ available: booleanField, reason: nullableStringField }, ['available']),
    withdraw: objectSchema({ available: booleanField, reason: nullableStringField, type: stringField }, ['available', 'type']),
    quickDeposit: objectSchema({ available: booleanField, reason: nullableStringField }, ['available']),
    p2pMatching: objectSchema({ available: booleanField, reason: nullableStringField }, ['available']),
  }, ['addMoney', 'withdraw', 'quickDeposit', 'p2pMatching']),
}, ['enabled', 'gateEnabled', 'status', 'blockers', 'capabilities']);

const nestedResponseSchemas: Record<string, Record<string, Record<string, unknown>>> = {
  'get /admin/settings': {
    financialSafety: objectSchema({ financialOperationsEnabled: booleanField, walletAdjustmentsEnabled: booleanField, dedicatedAdminAdjustmentAccount: stringField, adjustmentFundBalancePaise: nullableStringField, adjustmentFundHasFunds: booleanField, singleAdminAdjustmentAccountConfigured: booleanField, independentApprovalImplemented: booleanField, independentApprovalAvailable: booleanField, independentCheckerAvailable: booleanField, activeSuperAdminCount: integerField, fundingWorkflowEnabled: booleanField, creditWorkflowEnabled: booleanField, walletCreditBlockers: arrayOf(stringField), walletCreditReadiness: stringField, stagingDirectWalletCreditsEnabled: booleanField, stagingDirectWalletCreditBlockers: arrayOf(stringField), walletProductionApproved: booleanField, makerCheckerMigration: stringField, walletLedgerIntegrity: stringField, creditRequestLedgerLinks: stringField, fundingRequestLedgerLinks: stringField, fundingProvenance: stringField, activeSuperAdminCountStatus: stringField, externalBankReconciliation: stringField, settlementCashAccount: objectSchema({ status: stringField, balancePaise: nullableStringField }), adminAdjustmentControlsReady: booleanField, superAdminWalletCreditsEnabled: booleanField, superAdminCreditPrerequisitesReady: booleanField, productionEnablementSupported: booleanField, explanation: stringField }),
  },
  'get /admin/wallet/credits/requests': {
    requests: arrayOf(objectSchema({ id: stringField, targetUserId: stringField, amountPaise: integerField, reason: stringField, status: stringField, makerUserId: stringField, checkerUserId: nullableStringField, decisionReason: nullableStringField, ledgerTransactionId: nullableStringField, idempotencyKey: stringField, createdAt: dateField, decidedAt: nullableDateField, targetUser: objectSchema({ publicId: nullableStringField, displayName: nullableStringField, status: stringField, phoneMasked: stringField }), makerUser: miniAdminUserSchema, checkerUser: miniAdminUserSchema }, ['id', 'targetUserId', 'amountPaise', 'reason', 'status', 'makerUserId', 'createdAt', 'targetUser'])),
  },
  'post /admin/wallet/credits/requests': {
    request: objectSchema({ id: stringField, targetUserId: stringField, amountPaise: integerField, reason: stringField, status: stringField, makerUserId: stringField, checkerUserId: nullableStringField, decisionReason: nullableStringField, ledgerTransactionId: nullableStringField, idempotencyKey: stringField, createdAt: dateField, decidedAt: nullableDateField }, ['id', 'targetUserId', 'amountPaise', 'reason', 'status', 'makerUserId', 'idempotencyKey', 'createdAt']),
  },
  'post /admin/wallet/credits/direct': {
    credit: objectSchema({ id: stringField, reference: stringField, targetUserId: nullableStringField, direction: stringField, amountPaise: integerField, reason: stringField, createdAt: dateField, replayed: booleanField, balancePaise: integerField }, ['id', 'direction', 'amountPaise', 'reason', 'createdAt', 'replayed', 'balancePaise']),
  },
  'post /admin/wallet/credits/requests/{id}/decision': {
    request: objectSchema({ id: stringField, targetUserId: stringField, amountPaise: integerField, reason: stringField, status: stringField, makerUserId: stringField, checkerUserId: nullableStringField, decisionReason: nullableStringField, ledgerTransactionId: nullableStringField, idempotencyKey: stringField, createdAt: dateField, decidedAt: nullableDateField }, ['id', 'targetUserId', 'amountPaise', 'reason', 'status', 'makerUserId', 'idempotencyKey', 'createdAt']),
    credit: objectSchema({ id: stringField, reference: stringField, targetUserId: nullableStringField, direction: stringField, amountPaise: integerField, reason: stringField, createdAt: dateField, replayed: booleanField, balancePaise: integerField }),
  },
  'get /admin/wallet/funding/requests': {
    requests: arrayOf(objectSchema({ id: stringField, amountPaise: integerField, sourceAccountLabel: stringField, externalReferenceHash: stringField, evidenceReference: stringField, evidenceSha256: stringField, statementDate: { type: 'string', format: 'date' }, reason: stringField, status: stringField, makerUserId: stringField, checkerUserId: nullableStringField, decisionReason: nullableStringField, ledgerTransactionId: nullableStringField, idempotencyKey: stringField, createdAt: dateField, decidedAt: nullableDateField, makerUser: miniAdminUserSchema, checkerUser: miniAdminUserSchema }, ['id', 'amountPaise', 'sourceAccountLabel', 'externalReferenceHash', 'evidenceReference', 'evidenceSha256', 'statementDate', 'reason', 'status', 'makerUserId', 'idempotencyKey', 'createdAt'])),
  },
  'post /admin/wallet/funding/requests': {
    request: objectSchema({ id: stringField, amountPaise: integerField, sourceAccountLabel: stringField, externalReferenceHash: stringField, evidenceReference: stringField, evidenceSha256: stringField, statementDate: { type: 'string', format: 'date' }, reason: stringField, status: stringField, makerUserId: stringField, checkerUserId: nullableStringField, decisionReason: nullableStringField, ledgerTransactionId: nullableStringField, idempotencyKey: stringField, createdAt: dateField, decidedAt: nullableDateField }, ['id', 'amountPaise', 'sourceAccountLabel', 'externalReferenceHash', 'evidenceReference', 'evidenceSha256', 'statementDate', 'reason', 'status', 'makerUserId', 'idempotencyKey', 'createdAt']),
  },
  'post /admin/wallet/funding/requests/{id}/decision': {
    request: objectSchema({ id: stringField, amountPaise: integerField, sourceAccountLabel: stringField, externalReferenceHash: stringField, evidenceReference: stringField, evidenceSha256: stringField, statementDate: { type: 'string', format: 'date' }, reason: stringField, status: stringField, makerUserId: stringField, checkerUserId: nullableStringField, decisionReason: nullableStringField, ledgerTransactionId: nullableStringField, idempotencyKey: stringField, createdAt: dateField, decidedAt: nullableDateField }, ['id', 'amountPaise', 'sourceAccountLabel', 'externalReferenceHash', 'evidenceReference', 'evidenceSha256', 'statementDate', 'reason', 'status', 'makerUserId', 'idempotencyKey', 'createdAt']),
  },
  'get /admin/wallet/reconciliation': {
    accounts: arrayOf(objectSchema({ accountId: nullableStringField, type: nullableStringField, balancePaise: stringField, debitsPaise: stringField, creditsPaise: stringField })),
  },
  'get /admin/reports': {
    from: { type: 'string', format: 'date' },
    to: { type: 'string', format: 'date' },
    totalAmountPaise: stringField,
    statusBreakdown: arrayOf(objectSchema({ status: stringField, count: integerField, amountPaise: stringField }, ['status', 'count'])),
    daily: arrayOf(objectSchema({ date: { type: 'string', format: 'date' }, count: integerField, amountPaise: stringField }, ['date', 'count'])),
  },
  'get /config': {
    financialOperations: financialOperationsSchema,
    upiDeposit: objectSchema({ receiverVpa: nullableStringField, minAmountPaise: integerField, maxAmountPaise: integerField, rewardPercentBps: integerField, rewardEnabled: booleanField, rewardMessage: stringField, paymentInitiation: stringField, verificationMode: stringField, automaticVerificationAvailable: booleanField, message: stringField }),
    methods: arrayOf(objectSchema({ name: stringField, method: stringField, buyEnabled: booleanField, sellEnabled: booleanField, walletIntegration: objectSchema({ providerFlow: { type: 'string', nullable: true }, status: stringField, linkingDocumented: booleanField, available: booleanField, message: stringField }), enabled: booleanField, providerApproved: booleanField, providerConfigured: booleanField, integrationOperational: booleanField, available: booleanField, status: stringField, availabilityMessage: stringField })),
  },
  'get /wallet-methods': {
    financialOperations: financialOperationsSchema,
    upiDeposit: objectSchema({ receiverVpa: nullableStringField, minAmountPaise: integerField, maxAmountPaise: integerField, rewardPercentBps: integerField, rewardEnabled: booleanField, rewardMessage: stringField, paymentInitiation: stringField, verificationMode: stringField, automaticVerificationAvailable: booleanField, message: stringField }),
    methods: arrayOf(objectSchema({ name: stringField, method: stringField, buyEnabled: booleanField, sellEnabled: booleanField, walletIntegration: objectSchema({ providerFlow: { type: 'string', nullable: true }, status: stringField, linkingDocumented: booleanField, available: booleanField, message: stringField }), enabled: booleanField, providerApproved: booleanField, providerConfigured: booleanField, integrationOperational: booleanField, available: booleanField, status: stringField, availabilityMessage: stringField })),
    walletActivation: objectSchema({ activeCount: integerField, targetCount: nullableIntegerField, progressPercent: nullableIntegerField, booster: objectSchema({ configured: booleanField, eligible: booleanField, message: stringField }) }),
  },
  'post /auth/verify-otp': {
    user: objectSchema({ id: stringField, publicId: nullableStringField, displayName: nullableStringField, status: stringField, referralCode: nullableStringField }, ['id', 'status']),
    welcomeBonus: objectSchema({ status: stringField, amountPaise: integerField }, ['status', 'amountPaise']),
  },
  'post /auth/password/login': {
    user: objectSchema({ id: stringField, publicId: nullableStringField, displayName: nullableStringField, status: stringField, referralCode: nullableStringField }, ['id', 'status']),
    welcomeBonus: objectSchema({ status: stringField, amountPaise: integerField }, ['status', 'amountPaise']),
  },
  'post /auth/register/verify-otp': {
    user: objectSchema({ publicId: stringField }, ['publicId']),
    welcomeBonus: objectSchema({ status: stringField, amountPaise: integerField }, ['status', 'amountPaise']),
  },
  'post /admin/auth/login': {
    user: objectSchema({ publicId: stringField, displayName: nullableStringField }, ['publicId']),
  },
  'get /users/me': {
    user: objectSchema({ id: stringField, publicId: nullableStringField, phoneE164: stringField, displayName: nullableStringField, avatarId: nullableStringField, status: stringField, referralCode: nullableStringField, createdAt: dateField }, ['id', 'phoneE164', 'status', 'createdAt']),
  },
  'post /wallet-references': {
    wallet: objectSchema({ id: stringField, userId: stringField, method: stringField, reference: nullableStringField, status: stringField, buyEnabled: booleanField, sellEnabled: booleanField, createdAt: dateField, updatedAt: dateField, connected: booleanField }, ['id', 'userId', 'method', 'status', 'buyEnabled', 'sellEnabled', 'createdAt', 'updatedAt', 'connected']),
  },
  'get /deposits': { deposits: arrayOf(depositSchema) },
  'post /deposits': {
    deposit: depositSchema,
    checkout: objectSchema({ orderId: stringField, paymentSessionId: stringField, environment: stringField }, ['orderId', 'paymentSessionId', 'environment']),
  },
  'get /deposits/{id}': { deposit: depositSchema },
  'post /deposits/{id}/manual-verification': {
    claim: objectSchema({ id: stringField, status: stringField, createdAt: dateField, evidenceAttached: booleanField }, ['id', 'status', 'createdAt', 'evidenceAttached']),
    deposit: depositSchema,
  },
  'post /deposits/{id}/cancel': { deposit: objectSchema({ id: stringField, status: stringField, expiresAt: nullableDateField }, ['id', 'status']) },
  'get /orders': { orders: arrayOf(legacyOrderSchema) },
  'post /orders': { order: legacyOrderSchema },
  'post /orders/{id}/reservations': { order: legacyOrderSchema },
  'get /orders/{id}': { order: legacyOrderSchema },
  'post /orders/{id}/dispute': { order: objectSchema({ id: stringField, status: stringField }, ['id', 'status']) },
  'post /withdrawals': { withdrawalOffer: p2pOfferSchema },
  'get /withdrawals': {
    withdrawals: arrayOf(objectSchema({ id: stringField, userId: stringField, amountPaise: integerField, currency: stringField, destinationToken: stringField, status: stringField, idempotencyKey: stringField, payoutReference: nullableStringField, ledgerTransactionId: nullableStringField, createdAt: dateField, updatedAt: dateField })),
    offers: arrayOf(p2pOfferSchema),
  },
  'get /withdrawals/marketplace': { offers: arrayOf(objectSchema({ id: stringField, referenceId: stringField, amountPaise: integerField, paymentMethod: stringField, status: stringField, createdAt: dateField, expiresAt: dateField, matchedAmountPaise: integerField, remainingAmountPaise: integerField }, ['id', 'referenceId', 'amountPaise', 'paymentMethod', 'status', 'createdAt', 'expiresAt', 'matchedAmountPaise', 'remainingAmountPaise'])) },
  'post /withdrawals/offers/{id}/cancel': { offer: objectSchema({ id: stringField, referenceId: stringField, status: stringField, amountPaise: integerField }, ['id', 'referenceId', 'status', 'amountPaise']) },
  'post /deposits/quick-match': {
    order: p2pOrderSchema,
    withdrawalOffer: objectSchema({ id: stringField, referenceId: stringField, amountPaise: integerField, remainingAmountPaise: integerField, paymentMethod: stringField }, ['id', 'referenceId', 'amountPaise', 'remainingAmountPaise', 'paymentMethod']),
    reward: p2pRewardPreviewSchema,
  },
  'get /deposits/orders/my': { orders: arrayOf(p2pOrderSchema) },
  'get /deposits/orders/{id}': { order: p2pOrderSchema },
  'post /deposits/orders/{id}/confirm': {
    order: objectSchema({ id: stringField, referenceId: stringField, amountPaise: integerField, currency: stringField, status: stringField, expiresAt: nullableDateField, paymentDetailsShownAt: dateField }, ['id', 'referenceId', 'amountPaise', 'currency', 'status', 'paymentDetailsShownAt']),
    paymentDetails: objectSchema({ method: stringField, payeeVpa: stringField, payeeName: nullableStringField, ownershipStatus: stringField }, ['method', 'payeeVpa', 'ownershipStatus']),
  },
  'post /deposits/orders/{id}/handoff-attempt': { order: objectSchema({ id: stringField, status: stringField, paymentHandoffStartedAt: dateField }, ['id', 'status', 'paymentHandoffStartedAt']) },
  'post /deposits/orders/{id}/payment-reference': {
    claim: objectSchema({ id: stringField, status: stringField, transactionReference: nullableStringField, claimedAmountPaise: nullableIntegerField, claimedPaidAt: nullableDateField, createdAt: dateField, evidenceAttached: booleanField }, ['id', 'status', 'claimedAmountPaise', 'claimedPaidAt', 'createdAt', 'evidenceAttached']),
    order: objectSchema({ id: stringField, referenceId: stringField, status: stringField }, ['id', 'referenceId', 'status']),
  },
  'post /deposits/orders/{id}/cancel': { order: p2pOrderSchema },
  'get /admin/p2p/offers': { offers: arrayOf(p2pAdminOfferSchema), page: integerField, pageSize: integerField, total: integerField },
  'post /admin/p2p/offers/{id}/cancel': { offer: objectSchema({ id: stringField, referenceId: stringField, status: stringField, amountPaise: integerField }, ['id', 'referenceId', 'status', 'amountPaise']) },
  'get /admin/p2p/orders': { orders: arrayOf(p2pAdminOrderSchema), page: integerField, pageSize: integerField, total: integerField },
  'get /admin/p2p/claims': { claims: arrayOf(adminP2pClaimListItemSchema), page: integerField, pageSize: integerField, total: integerField },
  'get /admin/p2p/claims/{claimId}': { claim: adminP2pClaimDetailSchema },
  'post /admin/p2p/claims/{id}/review': { claim: objectSchema({ id: stringField, status: stringField }, ['id', 'status']) },
  'post /support/tickets': { ticket: objectSchema({ id: stringField, subject: stringField, status: stringField, createdAt: dateField }, ['id', 'subject', 'status', 'createdAt']) },
  'get /admin/deposits': { deposits: arrayOf(objectSchema({ id: stringField, amountPaise: integerField, currency: stringField, method: stringField, status: stringField, merchantReference: stringField, providerReference: nullableStringField, createdAt: dateField, updatedAt: dateField, user: objectSchema({ publicId: nullableStringField, displayName: nullableStringField, phoneMasked: stringField }), manualPaymentClaim: paymentClaimSchema })) },
  'get /admin/withdrawals': { withdrawals: arrayOf(objectSchema({ id: stringField, amountPaise: integerField, currency: stringField, status: stringField, payoutReference: nullableStringField, createdAt: dateField, updatedAt: dateField, user: objectSchema({ publicId: nullableStringField, displayName: nullableStringField, phoneMasked: stringField }) })) },
  'get /admin/transactions': { transactions: arrayOf(objectSchema({ id: stringField, referenceId: stringField, type: stringField, amountPaise: integerField, status: stringField, method: nullableStringField, createdAt: dateField, userId: nullableStringField })) },
  'get /admin/wallets/ledger': { entries: arrayOf(objectSchema({ id: stringField, userId: nullableStringField, accountType: stringField, currency: stringField, creditPaise: integerField, debitPaise: integerField, transaction: objectSchema({ id: stringField, eventType: stringField, referenceType: stringField, referenceId: stringField, actorUserId: nullableStringField }, ['id', 'eventType', 'referenceType', 'referenceId']), createdAt: dateField })) },
  'get /admin/notifications': { notifications: arrayOf(objectSchema({ id: stringField, title: stringField, body: stringField, readAt: nullableDateField, createdAt: dateField, user: objectSchema({ publicId: nullableStringField, displayName: nullableStringField }) }, ['id', 'title', 'body', 'createdAt', 'user'])) },
  'get /admin/reward-rules': { rules: arrayOf(objectSchema({ id: stringField, name: stringField, eligibility: { type: 'object', additionalProperties: true }, amountPaise: integerField, fundingSource: nullableStringField, enabled: booleanField, updatedAt: dateField }, ['id', 'name', 'eligibility', 'amountPaise', 'enabled', 'updatedAt'])) },
  'patch /admin/reward-rules/{id}': { rule: objectSchema({ id: stringField, name: stringField, eligibility: { type: 'object', additionalProperties: true }, amountPaise: integerField, fundingSource: nullableStringField, enabled: booleanField, updatedAt: dateField }, ['id', 'name', 'eligibility', 'amountPaise', 'enabled', 'updatedAt']) },
  'get /admin/support/tickets/{id}': { ticket: objectSchema({ id: stringField, userId: stringField, subject: stringField, status: stringField, createdAt: dateField, updatedAt: dateField, messages: arrayOf(objectSchema({ id: stringField, authorId: nullableStringField, message: stringField, createdAt: dateField }, ['id', 'message', 'createdAt'])), user: objectSchema({ publicId: nullableStringField, displayName: nullableStringField, phoneMasked: stringField }) }, ['id', 'userId', 'subject', 'status', 'createdAt', 'updatedAt', 'messages', 'user']) },
  'post /admin/support/tickets/{id}/reply': { message: objectSchema({ id: stringField, ticketId: stringField, authorId: nullableStringField, message: stringField, createdAt: dateField }, ['id', 'ticketId', 'message', 'createdAt']) },
  'post /admin/wallet-adjustments': { adjustment: objectSchema({ id: stringField, targetUserId: stringField, direction: { type: 'string', enum: ['CREDIT', 'DEBIT'] }, amountPaise: integerField, reason: stringField, createdAt: dateField, replayed: booleanField }, ['id', 'targetUserId', 'direction', 'amountPaise', 'reason', 'createdAt', 'replayed']) },
  'patch /admin/support/tickets/{id}/status': { ticket: objectSchema({ id: stringField, status: stringField, updatedAt: dateField }, ['id', 'status', 'updatedAt']) },
  'post /admin/push-devices': { device: objectSchema({ id: stringField, platform: stringField, lastRegisteredAt: dateField }, ['id', 'platform', 'lastRegisteredAt']) },
  'get /admin/push-events': { events: arrayOf(objectSchema({ id: stringField, type: stringField, title: stringField, body: stringField, claimId: stringField, createdAt: dateField, pushAccepted: booleanField, pushDeliveryCount: integerField }, ['id', 'type', 'title', 'body', 'claimId', 'createdAt', 'pushAccepted', 'pushDeliveryCount'])) },
  'get /admin/users': { users: arrayOf(objectSchema({ id: stringField, publicId: nullableStringField, displayName: nullableStringField, status: stringField, createdAt: dateField, updatedAt: dateField, phoneMasked: stringField, lastLogin: nullableDateField, walletBalancePaise: integerField, reservedBalancePaise: integerField, totalDepositsPaise: integerField, totalWithdrawalsPaise: integerField, totalTransactions: integerField }, ['id', 'status', 'createdAt', 'updatedAt', 'phoneMasked', 'walletBalancePaise', 'reservedBalancePaise', 'totalDepositsPaise', 'totalWithdrawalsPaise', 'totalTransactions'])) },
  'get /admin/users/{id}': { user: objectSchema({ id: stringField, publicId: nullableStringField, displayName: nullableStringField, status: stringField, createdAt: dateField, updatedAt: dateField, adminRole: objectSchema({ role: stringField }), _count: objectSchema({ deposits: integerField, withdrawals: integerField, buyOrders: integerField, sellOrders: integerField }), phoneMasked: stringField, totalTransactions: integerField, walletBalancePaise: integerField, reservedBalancePaise: integerField, recentLedgerEntries: arrayOf(objectSchema({ id: stringField, creditPaise: integerField, debitPaise: integerField, createdAt: dateField, account: objectSchema({ type: stringField, currency: stringField }), transaction: objectSchema({ id: stringField, eventType: stringField, referenceType: stringField, referenceId: stringField, actorUserId: nullableStringField }) })) }, ['id', 'status', 'createdAt', 'updatedAt', '_count', 'phoneMasked', 'totalTransactions', 'walletBalancePaise', 'reservedBalancePaise', 'recentLedgerEntries']) },
  'get /admin/users/{id}/wallet/credits': { credits: arrayOf(objectSchema({ id: stringField, transactionReference: stringField, adminId: stringField, amountPaise: integerField, reason: stringField, createdAt: dateField }, ['id', 'transactionReference', 'adminId', 'amountPaise', 'reason', 'createdAt'])), auditLogs: arrayOf(objectSchema({ id: stringField, adminId: stringField, reason: stringField, transactionReference: stringField, createdAt: dateField }, ['id', 'adminId', 'createdAt'])), requests: arrayOf(objectSchema({ id: stringField, amountPaise: integerField, reason: stringField, status: stringField, displayStatus: stringField, makerUserId: stringField, checkerUserId: nullableStringField, decisionReason: nullableStringField, ledgerTransactionId: nullableStringField, createdAt: dateField, decidedAt: nullableDateField, makerUser: objectSchema({ publicId: nullableStringField, displayName: nullableStringField }), checkerUser: { ...objectSchema({ publicId: nullableStringField, displayName: nullableStringField }), nullable: true } }, ['id', 'amountPaise', 'reason', 'status', 'displayStatus', 'makerUserId', 'makerUser', 'createdAt'])), requestTotal: integerField },
  'post /admin/users/{id}/status': { user: objectSchema({ id: stringField, publicId: nullableStringField, status: stringField }, ['id', 'status']) },
  'get /admin/system-health': { payments: arrayOf(objectSchema({ name: stringField, status: stringField, available: booleanField }, ['name', 'status', 'available'])) },
  'get /admin/disputes': { disputes: arrayOf(objectSchema({ id: stringField, referenceId: stringField, kind: stringField, amountPaise: integerField, status: stringField, createdAt: dateField, history: arrayOf(objectSchema({ id: stringField, orderId: stringField, status: stringField, actorId: nullableStringField, reason: nullableStringField, createdAt: dateField })), buyer: userMaskedSchema, seller: userMaskedSchema, latestClaim: paymentClaimSchema })), total: integerField, page: integerField, pageSize: integerField },
  'get /admin/support/tickets': { tickets: arrayOf(objectSchema({ id: stringField, subject: stringField, status: stringField, createdAt: dateField, updatedAt: dateField, user: objectSchema({ publicId: nullableStringField, displayName: nullableStringField, phoneMasked: stringField }), _count: objectSchema({ messages: integerField }) }, ['id', 'subject', 'status', 'createdAt', 'updatedAt', 'user', '_count'])) },
  'get /admin/reconciliation/claims': { claims: arrayOf(objectSchema({ id: stringField, depositId: stringField, userId: stringField, transactionReference: nullableStringField, status: stringField, evidenceMimeType: nullableStringField, createdAt: dateField, reviewedAt: nullableDateField, reviewReason: nullableStringField, verifiedAmountPaise: nullableIntegerField, verifiedCurrency: nullableStringField, receiverConfirmed: booleanField, deposit: objectSchema({ id: stringField, merchantReference: stringField, amountPaise: integerField, currency: stringField, status: stringField, createdAt: dateField }, ['id', 'merchantReference', 'amountPaise', 'currency', 'status', 'createdAt']), user: objectSchema({ publicId: nullableStringField, displayName: nullableStringField, phoneMasked: stringField }) }, ['id', 'depositId', 'userId', 'status', 'createdAt', 'receiverConfirmed', 'deposit', 'user'])), total: integerField, page: integerField, pageSize: integerField },
  'post /admin/reconciliation/claims/{claimId}/review': {
    claim: objectSchema({ id: stringField, status: stringField, reviewedAt: nullableDateField }, ['id', 'status']),
    deposit: objectSchema({ id: stringField, status: stringField, amountPaise: integerField, currency: stringField }, ['id', 'status', 'amountPaise', 'currency']),
  },
  'patch /users/me': {
    user: objectSchema({ id: stringField, phoneE164: stringField, displayName: nullableStringField, avatarId: nullableStringField, status: stringField, referralCode: nullableStringField }, ['id', 'phoneE164', 'status']),
  },
  'post /users/me/bank-accounts': {
    bankAccount: objectSchema({ id: stringField, accountHolderName: stringField, bankName: nullableStringField, maskedAccountNumber: stringField, ifsc: stringField, verificationStatus: stringField, verifiedAt: nullableDateField, createdAt: dateField }, ['id', 'accountHolderName', 'maskedAccountNumber', 'ifsc', 'verificationStatus', 'createdAt']),
  },
  'patch /users/me/bank-accounts/{id}': {
    bankAccount: objectSchema({ id: stringField, accountHolderName: stringField, bankName: nullableStringField, maskedAccountNumber: stringField, ifsc: stringField, verificationStatus: stringField, verifiedAt: nullableDateField, createdAt: dateField }, ['id', 'accountHolderName', 'maskedAccountNumber', 'ifsc', 'verificationStatus', 'createdAt']),
  },
  'get /users/me/vip': {
    volume: objectSchema({ settledWithdrawalPaise: integerField, verifiedOrderPaise: integerField, currency: stringField }, ['settledWithdrawalPaise', 'verifiedOrderPaise', 'currency']),
    levels: arrayOf(objectSchema({ levelNumber: integerField, displayName: stringField, metric: stringField, targetPaise: integerField, currentPaise: integerField, rewardPaise: integerField, progressPercent: integerField, achieved: booleanField, rewardStatus: stringField, creditedPaise: integerField }, ['levelNumber', 'displayName', 'metric', 'targetPaise', 'currentPaise', 'rewardPaise', 'progressPercent', 'achieved', 'rewardStatus', 'creditedPaise'])),
    activeLevels: integerField,
  },
  'get /users/me/referrals': {
    commissionRates: objectSchema({ directBps: integerField, indirectBps: integerField }, ['directBps', 'indirectBps']),
    milestones: arrayOf(objectSchema({ key: stringField, requiredReferrals: integerField, qualifyingTopUpPaise: nullableIntegerField, rewardAmountPaise: integerField, qualifiedReferrals: integerField, status: stringField }, ['key', 'requiredReferrals', 'rewardAmountPaise', 'qualifiedReferrals', 'status'])),
    commissionHistory: arrayOf(objectSchema({ id: stringField, amountPaise: integerField, status: stringField, kind: stringField, level: integerField, createdAt: dateField }, ['id', 'amountPaise', 'status', 'kind', 'level', 'createdAt'])),
    members: arrayOf(objectSchema({ id: stringField, displayName: nullableStringField, permittedIdentifier: stringField, depth: integerField, joinedAt: dateField, verifiedTopUpPaise: integerField, earningsGeneratedPaise: integerField }, ['id', 'permittedIdentifier', 'depth', 'joinedAt', 'verifiedTopUpPaise', 'earningsGeneratedPaise'])),
  },
  'get /users/me/transactions': {
    transactions: arrayOf(objectSchema({ id: stringField, type: stringField, amountPaise: integerField, reference: stringField, description: stringField, displayDescription: stringField, createdAt: dateField }, ['id', 'type', 'amountPaise', 'reference', 'description', 'displayDescription', 'createdAt'])),
  },
  'get /notifications': {
    notifications: arrayOf(objectSchema({ id: stringField, userId: stringField, title: stringField, body: stringField, readAt: nullableDateField, createdAt: dateField }, ['id', 'userId', 'title', 'body', 'createdAt'])),
  },
  'get /support/tickets': {
    tickets: arrayOf(objectSchema({ id: stringField, subject: stringField, status: stringField, createdAt: dateField, updatedAt: dateField }, ['id', 'subject', 'status', 'createdAt', 'updatedAt'])),
  },
  'get /support/tickets/{id}': {
    ticket: objectSchema({ id: stringField, userId: stringField, subject: stringField, status: stringField, createdAt: dateField, updatedAt: dateField, messages: arrayOf(objectSchema({ id: stringField, authorId: nullableStringField, message: stringField, createdAt: dateField }, ['id', 'message', 'createdAt'])) }, ['id', 'userId', 'subject', 'status', 'createdAt', 'updatedAt', 'messages']),
  },
  'get /admin/overview': {
    metrics: objectSchema({ users: integerField, activeUsers: integerField, blockedUsers: integerField, newUsersToday: integerField, totalWalletBalancePaise: integerField, totalReservedBalancePaise: integerField, totalDeposits: integerField, totalWithdrawals: integerField, totalDepositValuePaise: integerField, totalWithdrawalValuePaise: integerField, pendingDeposits: integerField, pendingWithdrawals: integerField, completedTransactions: integerField, failedTransactions: integerField, disputedTransactions: integerField, totalPlatformRevenuePaise: nullableIntegerField, commissionEarnedPaise: integerField, todayTransactionVolumePaise: integerField }),
    charts: objectSchema({ daily: arrayOf(objectSchema({ date: dateField, depositsPaise: integerField, withdrawalsPaise: integerField, registrations: integerField })), weekly: arrayOf(objectSchema({ date: dateField, depositsPaise: integerField, withdrawalsPaise: integerField, registrations: integerField })), monthly: arrayOf(objectSchema({ date: dateField, depositsPaise: integerField, withdrawalsPaise: integerField, registrations: integerField })) }),
    pendingAdminActions: objectSchema({ manualDeposits: integerField, p2pClaims: integerField, openP2pOffers: integerField }),
    system: objectSchema({ api: stringField, database: stringField }),
    recentTransactions: arrayOf(objectSchema({ id: stringField, amountPaise: integerField, currency: stringField, method: stringField, status: stringField, createdAt: dateField, user: objectSchema({ publicId: nullableStringField, displayName: nullableStringField }), userName: stringField })),
    recentUsers: arrayOf(objectSchema({ publicId: nullableStringField, displayName: nullableStringField, status: stringField, createdAt: dateField })),
  },
  'get /admin/referrals': {
    referrals: arrayOf(objectSchema({ id: stringField, referrerId: stringField, inviteeId: stringField, referralCode: stringField, status: stringField, createdAt: dateField, referrer: objectSchema({ publicId: nullableStringField, displayName: nullableStringField }), invitee: objectSchema({ publicId: nullableStringField, displayName: nullableStringField, createdAt: dateField }) }, ['id', 'referrerId', 'inviteeId', 'referralCode', 'status', 'createdAt', 'referrer', 'invitee'])),
    commissionPolicy: objectSchema({ directRateBps: integerField, indirectRateBps: integerField, basis: stringField, funding: stringField }),
  },
  'get /admin/referrals/config': {
    config: objectSchema({ directRateBps: integerField, indirectRateBps: integerField, updatedAt: dateField }),
    milestones: arrayOf(objectSchema({ id: stringField, key: stringField, requiredReferrals: integerField, qualifyingTopUpPaise: nullableIntegerField, rewardAmountPaise: integerField, enabled: booleanField, updatedAt: dateField })),
  },
  'patch /admin/referrals/config': {
    config: objectSchema({ directRateBps: integerField, indirectRateBps: integerField, updatedAt: dateField }),
  },
  'patch /admin/referrals/milestones/{key}': {
    milestone: objectSchema({ id: stringField, key: stringField, requiredReferrals: integerField, qualifyingTopUpPaise: nullableIntegerField, rewardAmountPaise: integerField, enabled: booleanField, updatedAt: dateField }),
  },
  'get /admin/commissions': {
    commissions: arrayOf(objectSchema({ id: stringField, userId: stringField, qualifyingReference: stringField, amountPaise: integerField, fundingReference: stringField, status: stringField, kind: stringField, level: integerField, sourceUserId: nullableStringField, qualifyingAmountPaise: nullableIntegerField, createdAt: dateField }, ['id', 'userId', 'qualifyingReference', 'amountPaise', 'fundingReference', 'status', 'kind', 'level', 'createdAt'])),
    configuration: objectSchema({ directRateBps: integerField, indirectRateBps: integerField, referralBasis: stringField, payoutFundingConfigured: booleanField }),
  },
  'get /admin/providers': {
    upiDeposit: objectSchema({ receiverVpa: nullableStringField, minAmountPaise: integerField, maxAmountPaise: integerField, rewardPercentBps: integerField, rewardEnabled: booleanField, rewardMessage: stringField, paymentInitiation: stringField, verificationMode: stringField, automaticVerificationAvailable: booleanField, message: stringField }),
    methods: arrayOf(objectSchema({ name: stringField, method: stringField, buyEnabled: booleanField, sellEnabled: booleanField, walletIntegration: objectSchema({ providerFlow: { type: 'string', nullable: true }, status: stringField, linkingDocumented: booleanField, available: booleanField, message: stringField }), enabled: booleanField, providerApproved: booleanField, providerConfigured: booleanField, integrationOperational: booleanField, available: booleanField, status: stringField, availabilityMessage: stringField })),
  },
};

const arrayItemSchemas: Record<string, Record<string, Record<string, unknown>>> = {
  'get /admin/settings': { editableSettings: { type: 'string' } },
  'get /wallet-references': { wallets: objectSchema({ id: stringField, userId: stringField, method: stringField, reference: nullableStringField, status: stringField, buyEnabled: booleanField, sellEnabled: booleanField, createdAt: dateField, updatedAt: dateField, connected: booleanField }) },
  'get /users/me/bank-accounts': { bankAccounts: objectSchema({ id: stringField, accountHolderName: stringField, bankName: nullableStringField, maskedAccountNumber: stringField, ifsc: stringField, verificationStatus: stringField, verifiedAt: nullableDateField, createdAt: dateField }) },
  'post /support/tickets': { messages: objectSchema({ id: stringField, authorId: stringField, message: stringField, createdAt: dateField }) },
  'get /admin/audit-logs': { auditLogs: objectSchema({ id: stringField, actorId: stringField, action: stringField, target: stringField, reason: nullableStringField, metadata: { type: 'object', additionalProperties: true }, createdAt: dateField }) },
  'get /admin/admins': { admins: arrayOf(objectSchema({ role: stringField, createdAt: dateField, user: objectSchema({ id: stringField, publicId: nullableStringField, displayName: nullableStringField, status: stringField, phoneMasked: stringField }) })), total: integerField, page: integerField, pageSize: integerField },
};

function responseFieldSchema(name: string, operationKey: string): Record<string, unknown> {
  const nested = nestedResponseSchemas[operationKey]?.[name];
  if (nested) return nested;
  const override = responseTypeOverrides[operationKey]?.[name];
  if (override) return override;
  if (numericArrayResponseFields.has(name)) return { type: 'array', items: { type: 'integer' } };
  if (arrayResponseFields.has(name)) return { type: 'array', items: arrayItemSchemas[operationKey]?.[name] ?? (name === 'allowedSections' ? { type: 'string' } : { type: 'object', additionalProperties: true }) };
  if (objectResponseFields.has(name)) return { type: 'object', additionalProperties: true };
  if (booleanResponseFields.has(name) || name.startsWith('is')) return { type: 'boolean' };
  if (dateResponseFields.has(name) || name.endsWith('At')) return { type: 'string', format: 'date-time', ...(nullableResponseFields.has(name) ? { nullable: true } : {}) };
  if (stringResponseFields.has(name) || name.endsWith('Id') || name.endsWith('Code') || name.endsWith('Name') || name.endsWith('Status') || name.endsWith('Reference')) return { type: 'string', ...(nullableResponseFields.has(name) ? { nullable: true } : {}) };
  if (integerResponseFields.has(name) || name.endsWith('Paise') || name.endsWith('Bps') || name.endsWith('Count') || name === 'amountPaise' || name === 'total' || name === 'page' || name === 'pageSize' || name === 'currentLevel') return { type: 'integer', ...(nullableResponseFields.has(name) ? { nullable: true } : {}) };
  return { type: 'object', additionalProperties: true };
}

function endpointResponseSchema(operationKey: string, status: string): Record<string, unknown> | undefined {
  const statusSpecificFields: Record<string, string[]> = {
    'post /deposits/quick-match 200': ['order', 'withdrawalOffer', 'reward', 'message'],
  };
  const names = statusSpecificFields[`${operationKey} ${status}`] ?? responseFields[operationKey];
  if (!names) return undefined;
  return { type: 'object', additionalProperties: false, properties: Object.fromEntries(names.map((name) => [name, responseFieldSchema(name, operationKey)])) };
}

function completeOpenApi(input: unknown): MutableOpenApi {
  const spec = input as MutableOpenApi;
  spec.components.schemas.ApiError = {
    type: 'object', required: ['error'],
    properties: {
      error: { type: 'object', required: ['code', 'message'], properties: {
        code: { type: 'string' }, message: { type: 'string' },
        fields: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } } },
      } },
      requestId: { type: 'string' },
    },
  };
  for (const [path, verbs] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(verbs)) {
      const key = `${method} ${path}`;
      if (requestBodies[key]) operation.requestBody = requestBodies[key];
      const isPublic = path === '/config' || path.startsWith('/auth/') || path === '/admin/auth/login' || path.startsWith('/admin/auth/forgot-password/') || path === '/admin/auth/password/reset' || path.startsWith('/webhooks/payments/');
      if (!isPublic && !operation.security) operation.security = [{ bearerAuth: [] }];
      for (const [status, response] of Object.entries(operation.responses)) {
        if (status === '204') continue;
        if (path.endsWith('/evidence') && status === '200') {
          response.content = { 'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'image/png': { schema: { type: 'string', format: 'binary' } } };
        } else if (status.startsWith('2')) {
          const schema = endpointResponseSchema(key, status);
          if (schema) response.content = { 'application/json': { schema } };
          else if (!response.content) throw new Error(`OpenAPI success response has no endpoint schema: ${key} ${status}`);
        } else if (!response.content) {
          response.content = { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } };
        }
      }
      if (!isPublic && !operation.responses['401']) {
        operation.responses['401'] = {
          description: 'Authentication required or session invalid',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        };
      }
    }
  }
  for (const [method, route] of FINANCIAL_OPERATION_ROUTE_MANIFEST) {
    const path = route.replace(/^\/api\/v1/, '').replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const operation = spec.paths[path]?.[method.toLowerCase()];
    if (operation) {
      operation.responses['503'] = {
        description: `Financial operations are disabled (${FINANCIAL_OPERATIONS_DISABLED_CODE}); no financial change was made`,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
      };
    }
  }
  return spec;
}

export const openapi = completeOpenApi(openapiBase);
