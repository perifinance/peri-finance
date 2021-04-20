## `DelegateApprovals`

### `constructor(address _owner, contract EternalStorage _eternalStorage)` (public)

### `_getKey(bytes32 _action, address _authoriser, address _delegate) → bytes32` (internal)

### `canBurnFor(address authoriser, address delegate) → bool` (external)

### `canIssueFor(address authoriser, address delegate) → bool` (external)

### `canClaimFor(address authoriser, address delegate) → bool` (external)

### `canExchangeFor(address authoriser, address delegate) → bool` (external)

### `approvedAll(address authoriser, address delegate) → bool` (public)

### `_checkApproval(bytes32 action, address authoriser, address delegate) → bool` (internal)

### `approveAllDelegatePowers(address delegate)` (external)

### `removeAllDelegatePowers(address delegate)` (external)

### `approveBurnOnBehalf(address delegate)` (external)

### `removeBurnOnBehalf(address delegate)` (external)

### `approveIssueOnBehalf(address delegate)` (external)

### `removeIssueOnBehalf(address delegate)` (external)

### `approveClaimOnBehalf(address delegate)` (external)

### `removeClaimOnBehalf(address delegate)` (external)

### `approveExchangeOnBehalf(address delegate)` (external)

### `removeExchangeOnBehalf(address delegate)` (external)

### `_setApproval(bytes32 action, address authoriser, address delegate)` (internal)

### `_withdrawApproval(bytes32 action, address authoriser, address delegate)` (internal)

### `setEternalStorage(contract EternalStorage _eternalStorage)` (external)

### `Approval(address authoriser, address delegate, bytes32 action)`

### `WithdrawApproval(address authoriser, address delegate, bytes32 action)`

### `EternalStorageUpdated(address newEternalStorage)`
