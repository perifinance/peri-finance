pragma solidity 0.5.16;

interface IMultiChainDebtShareManager {
    // View Functions
    function multiChainDebtShareState() external view returns (address);

    function getCurrentExternalDebtEntry() external view returns (uint debtShare, bool isDecreased);

    // Mutative functions
    function setCurrentExternalDebtEntry(uint debtShare, bool isDecreased) external;

    function removeCurrentExternalDebtEntry() external;

    function setMultiChainDebtShareState(address multiChainDebtShareStateAddress) external;
}
