pragma solidity 0.5.16;

import "../SafeDecimalMath.sol";

contract MockEtherCollateral {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    uint public totalIssuedPynths;

    constructor() public {}

    // Mock openLoan function
    function openLoan(uint amount) external {
        // Increment totalIssuedPynths
        totalIssuedPynths = totalIssuedPynths.add(amount);
    }

    function closeLoan(uint amount) external {
        // Increment totalIssuedPynths
        totalIssuedPynths = totalIssuedPynths.sub(amount);
    }
}
