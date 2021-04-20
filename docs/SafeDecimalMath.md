## `SafeDecimalMath`

### `unit() → uint256` (external)

### `preciseUnit() → uint256` (external)

### `multiplyDecimal(uint256 x, uint256 y) → uint256` (internal)

A unit factor is divided out after the product of x and y is evaluated,
so that product must be less than 2\*\*256. As this is an integer division,
the internal division always rounds down. This helps save on gas. Rounding
is more expensive on gas.

### `multiplyDecimalRoundPrecise(uint256 x, uint256 y) → uint256` (internal)

The operands should be in the precise unit factor which will be
divided out after the product of x and y is evaluated, so that product must be
less than 2\*\*256.

Unlike multiplyDecimal, this function rounds the result to the nearest increment.
Rounding is useful when you need to retain fidelity for small decimal numbers
(eg. small fractions or percentages).

### `multiplyDecimalRound(uint256 x, uint256 y) → uint256` (internal)

The operands should be in the standard unit factor which will be
divided out after the product of x and y is evaluated, so that product must be
less than 2\*\*256.

Unlike multiplyDecimal, this function rounds the result to the nearest increment.
Rounding is useful when you need to retain fidelity for small decimal numbers
(eg. small fractions or percentages).

### `divideDecimal(uint256 x, uint256 y) → uint256` (internal)

y is divided after the product of x and the standard precision unit
is evaluated, so the product of x and UNIT must be less than 2\*\*256. As
this is an integer division, the result is always rounded down.
This helps save on gas. Rounding is more expensive on gas.

### `divideDecimalRound(uint256 x, uint256 y) → uint256` (internal)

y is divided after the product of x and the standard precision unit
is evaluated, so the product of x and the standard precision unit must
be less than 2\*\*256. The result is rounded to the nearest increment.

### `divideDecimalRoundPrecise(uint256 x, uint256 y) → uint256` (internal)

y is divided after the product of x and the high precision unit
is evaluated, so the product of x and the high precision unit must
be less than 2\*\*256. The result is rounded to the nearest increment.

### `decimalToPreciseDecimal(uint256 i) → uint256` (internal)

Convert a standard decimal representation to a high precision one.

### `preciseDecimalToDecimal(uint256 i) → uint256` (internal)

Convert a high precision decimal to a standard decimal representation.
