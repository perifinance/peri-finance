## `ExchangeState`

### `constructor(address _owner, address _associatedContract)` (public)

### `setMaxEntriesInQueue(uint256 _maxEntriesInQueue)` (external)

### `appendExchangeEntry(address account, bytes32 src, uint256 amount, bytes32 dest, uint256 amountReceived, uint256 exchangeFeeRate, uint256 timestamp, uint256 roundIdForSrc, uint256 roundIdForDest)` (external)

### `removeEntries(address account, bytes32 currencyKey)` (external)

### `getLengthOfEntries(address account, bytes32 currencyKey) → uint256` (external)

### `getEntryAt(address account, bytes32 currencyKey, uint256 index) → bytes32 src, uint256 amount, bytes32 dest, uint256 amountReceived, uint256 exchangeFeeRate, uint256 timestamp, uint256 roundIdForSrc, uint256 roundIdForDest` (external)

### `getMaxTimestamp(address account, bytes32 currencyKey) → uint256` (external)
