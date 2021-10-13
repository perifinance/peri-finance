pragma solidity 0.5.16;

interface IMultiChainDebtShareManager {
    // View Functions
    function getCurrentExternalDebtEntry() external view returns (uint debtShare);

    // Mutative functions
    function setCurrentExternalDebtEntry(uint debtShare) external;

    function removeCurrentExternalDebtEntry() external;

    function setMultiChainDebtShareState(address multiChainDebtShareState) external;
}
