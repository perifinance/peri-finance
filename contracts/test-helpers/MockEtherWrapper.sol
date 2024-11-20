pragma solidity ^0.5.16;

import "../SafeDecimalMath.sol";

contract MockEtherWrapper {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    uint public totalIssuedPynths;

    constructor() public {}

    function setTotalIssuedPynths(uint value) external {
        totalIssuedPynths = value;
    }
}
