## `ISystemStatus`

### `accessControl(bytes32 section, address account) → bool canSuspend, bool canResume` (external)

### `requireSystemActive()` (external)

### `requireIssuanceActive()` (external)

### `requireExchangeActive()` (external)

### `requireExchangeBetweenPynthsAllowed(bytes32 sourceCurrencyKey, bytes32 destinationCurrencyKey)` (external)

### `requirePynthActive(bytes32 currencyKey)` (external)

### `requirePynthsActive(bytes32 sourceCurrencyKey, bytes32 destinationCurrencyKey)` (external)

### `systemSuspension() → bool suspended, uint248 reason` (external)

### `issuanceSuspension() → bool suspended, uint248 reason` (external)

### `exchangeSuspension() → bool suspended, uint248 reason` (external)

### `pynthExchangeSuspension(bytes32 currencyKey) → bool suspended, uint248 reason` (external)

### `pynthSuspension(bytes32 currencyKey) → bool suspended, uint248 reason` (external)

### `getPynthExchangeSuspensions(bytes32[] pynths) → bool[] exchangeSuspensions, uint256[] reasons` (external)

### `getPynthSuspensions(bytes32[] pynths) → bool[] suspensions, uint256[] reasons` (external)

### `suspendPynth(bytes32 currencyKey, uint256 reason)` (external)

### `updateAccessControl(bytes32 section, address account, bool canSuspend, bool canResume)` (external)
