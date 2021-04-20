## `Math`

### `powDecimal(uint256 x, uint256 n) → uint256` (internal)

Uses "exponentiation by squaring" algorithm where cost is 0(logN)
vs 0(N) for naive repeated multiplication.
Calculates x^n with x as fixed-point and n as regular unsigned int.
Calculates to 18 digits of precision with SafeDecimalMath.unit()
