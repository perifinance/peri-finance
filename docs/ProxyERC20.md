## `ProxyERC20`

### `constructor(address _owner)` (public)

### `name() → string` (public)

### `symbol() → string` (public)

### `decimals() → uint8` (public)

### `totalSupply() → uint256` (public)

Total number of tokens in existence

### `balanceOf(address account) → uint256` (public)

Gets the balance of the specified address.

### `allowance(address owner, address spender) → uint256` (public)

Function to check the amount of tokens that an owner allowed to a spender.

### `transfer(address to, uint256 value) → bool` (public)

Transfer token for a specified address

### `approve(address spender, uint256 value) → bool` (public)

Approve the passed address to spend the specified amount of tokens on behalf of msg.sender.
Beware that changing an allowance with this method brings the risk that someone may use both the old
and the new allowance by unfortunate transaction ordering. One possible solution to mitigate this
race condition is to first reduce the spender's allowance to 0 and set the desired value afterwards:
https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729

### `transferFrom(address from, address to, uint256 value) → bool` (public)

Transfer tokens from one address to another
