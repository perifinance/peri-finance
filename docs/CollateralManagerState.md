## `CollateralManagerState`

### `constructor(address _owner, address _associatedContract)` (public)

### `incrementTotalLoans() → uint256` (external)

### `long(bytes32 pynth) → uint256` (external)

### `short(bytes32 pynth) → uint256` (external)

### `incrementLongs(bytes32 pynth, uint256 amount)` (external)

### `decrementLongs(bytes32 pynth, uint256 amount)` (external)

### `incrementShorts(bytes32 pynth, uint256 amount)` (external)

### `decrementShorts(bytes32 pynth, uint256 amount)` (external)

### `getRateAt(uint256 index) → uint256` (public)

### `getRatesLength() → uint256` (public)

### `updateBorrowRates(uint256 rate)` (external)

### `ratesLastUpdated() → uint256` (public)

### `getRatesAndTime(uint256 index) → uint256 entryRate, uint256 lastRate, uint256 lastUpdated, uint256 newIndex` (external)

### `addShortCurrency(bytes32 currency)` (external)

### `removeShortCurrency(bytes32 currency)` (external)

### `getShortRateAt(bytes32 currency, uint256 index) → uint256` (internal)

### `getShortRatesLength(bytes32 currency) → uint256` (public)

### `updateShortRates(bytes32 currency, uint256 rate)` (external)

### `shortRateLastUpdated(bytes32 currency) → uint256` (internal)

### `getShortRatesAndTime(bytes32 currency, uint256 index) → uint256 entryRate, uint256 lastRate, uint256 lastUpdated, uint256 newIndex` (external)
