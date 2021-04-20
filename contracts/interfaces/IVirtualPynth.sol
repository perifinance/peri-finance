pragma solidity >=0.4.24;

import "./IPynth.sol";


interface IVirtualPynth {
    // Views
    function balanceOfUnderlying(address account) external view returns (uint);

    function rate() external view returns (uint);

    function readyToSettle() external view returns (bool);

    function secsLeftInWaitingPeriod() external view returns (uint);

    function settled() external view returns (bool);

    function pynth() external view returns (IPynth);

    // Mutative functions
    function settle(address account) external;
}
