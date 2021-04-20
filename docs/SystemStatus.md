## `SystemStatus`

### `constructor(address _owner)` (public)

### `requireSystemActive()` (external)

### `requireIssuanceActive()` (external)

### `requireExchangeActive()` (external)

### `requirePynthExchangeActive(bytes32 currencyKey)` (external)

### `requirePynthActive(bytes32 currencyKey)` (external)

### `requirePynthsActive(bytes32 sourceCurrencyKey, bytes32 destinationCurrencyKey)` (external)

### `requireExchangeBetweenPynthsAllowed(bytes32 sourceCurrencyKey, bytes32 destinationCurrencyKey)` (external)

### `isSystemUpgrading() → bool` (external)

### `getPynthExchangeSuspensions(bytes32[] pynths) → bool[] exchangeSuspensions, uint256[] reasons` (external)

### `getPynthSuspensions(bytes32[] pynths) → bool[] suspensions, uint256[] reasons` (external)

### `updateAccessControl(bytes32 section, address account, bool canSuspend, bool canResume)` (external)

### `updateAccessControls(bytes32[] sections, address[] accounts, bool[] canSuspends, bool[] canResumes)` (external)

### `suspendSystem(uint256 reason)` (external)

### `resumeSystem()` (external)

### `suspendIssuance(uint256 reason)` (external)

### `resumeIssuance()` (external)

### `suspendExchange(uint256 reason)` (external)

### `resumeExchange()` (external)

### `suspendPynthExchange(bytes32 currencyKey, uint256 reason)` (external)

### `suspendPynthsExchange(bytes32[] currencyKeys, uint256 reason)` (external)

### `resumePynthExchange(bytes32 currencyKey)` (external)

### `resumePynthsExchange(bytes32[] currencyKeys)` (external)

### `suspendPynth(bytes32 currencyKey, uint256 reason)` (external)

### `suspendPynths(bytes32[] currencyKeys, uint256 reason)` (external)

### `resumePynth(bytes32 currencyKey)` (external)

### `resumePynths(bytes32[] currencyKeys)` (external)

### `_requireAccessToSuspend(bytes32 section)` (internal)

### `_requireAccessToResume(bytes32 section)` (internal)

### `_internalRequireSystemActive()` (internal)

### `_internalRequireIssuanceActive()` (internal)

### `_internalRequireExchangeActive()` (internal)

### `_internalRequirePynthExchangeActive(bytes32 currencyKey)` (internal)

### `_internalRequirePynthActive(bytes32 currencyKey)` (internal)

### `_internalSuspendPynths(bytes32[] currencyKeys, uint256 reason)` (internal)

### `_internalResumePynths(bytes32[] currencyKeys)` (internal)

### `_internalSuspendPynthExchange(bytes32[] currencyKeys, uint256 reason)` (internal)

### `_internalResumePynthsExchange(bytes32[] currencyKeys)` (internal)

### `_internalUpdateAccessControl(bytes32 section, address account, bool canSuspend, bool canResume)` (internal)

### `SystemSuspended(uint256 reason)`

### `SystemResumed(uint256 reason)`

### `IssuanceSuspended(uint256 reason)`

### `IssuanceResumed(uint256 reason)`

### `ExchangeSuspended(uint256 reason)`

### `ExchangeResumed(uint256 reason)`

### `PynthExchangeSuspended(bytes32 currencyKey, uint256 reason)`

### `PynthExchangeResumed(bytes32 currencyKey, uint256 reason)`

### `PynthSuspended(bytes32 currencyKey, uint256 reason)`

### `PynthResumed(bytes32 currencyKey, uint256 reason)`

### `AccessControlUpdated(bytes32 section, address account, bool canSuspend, bool canResume)`
