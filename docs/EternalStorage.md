## `EternalStorage`

This contract is based on the code available from this blog
https://blog.colony.io/writing-upgradeable-contracts-in-solidity-6743f0eecc88/
Implements support for storing a keccak256 key and value pairs. It is the more flexible
and extensible option. This ensures data schema changes can be implemented without
requiring upgrades to the storage contract.

### `constructor(address _owner, address _associatedContract)` (public)

### `getUIntValue(bytes32 record) → uint256` (external)

### `setUIntValue(bytes32 record, uint256 value)` (external)

### `deleteUIntValue(bytes32 record)` (external)

### `getStringValue(bytes32 record) → string` (external)

### `setStringValue(bytes32 record, string value)` (external)

### `deleteStringValue(bytes32 record)` (external)

### `getAddressValue(bytes32 record) → address` (external)

### `setAddressValue(bytes32 record, address value)` (external)

### `deleteAddressValue(bytes32 record)` (external)

### `getBytesValue(bytes32 record) → bytes` (external)

### `setBytesValue(bytes32 record, bytes value)` (external)

### `deleteBytesValue(bytes32 record)` (external)

### `getBytes32Value(bytes32 record) → bytes32` (external)

### `setBytes32Value(bytes32 record, bytes32 value)` (external)

### `deleteBytes32Value(bytes32 record)` (external)

### `getBooleanValue(bytes32 record) → bool` (external)

### `setBooleanValue(bytes32 record, bool value)` (external)

### `deleteBooleanValue(bytes32 record)` (external)

### `getIntValue(bytes32 record) → int256` (external)

### `setIntValue(bytes32 record, int256 value)` (external)

### `deleteIntValue(bytes32 record)` (external)
