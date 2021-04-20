## `MockExchanger`

### `constructor(contract IPeriFinance _periFinance)` (public)

### `settle(address from, bytes32 currencyKey) → uint256 reclaimed, uint256 refunded, uint256 numEntriesSettled` (external)

### `maxSecsLeftInWaitingPeriod(address, bytes32) → uint256` (public)

### `settlementOwing(address, bytes32) → uint256, uint256, uint256` (public)

### `hasWaitingPeriodOrSettlementOwing(address, bytes32) → bool` (external)

### `setReclaim(uint256 _reclaimAmount)` (external)

### `setRefund(uint256 _refundAmount)` (external)

### `setNumEntries(uint256 _numEntries)` (external)

### `setMaxSecsLeft(uint256 _maxSecsLeft)` (external)
