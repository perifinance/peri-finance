pragma solidity 0.5.16;

interface IMultiChainDebtShareState {
    struct DebtShareStorage {
        // Indicates how much addtional debt should be added or subtracted
        // This should be only pUSD amount
        uint debtShare;
        // When this data was added
        uint timeStamp;
    }

    // Views
    function debtShareStorageInfoAt(uint index) external view returns (uint debtShare, uint timeStamp);

    function debtShareStorageLength() external view returns (uint);

    function lastDebtShareStorageInfo() external view returns (uint debtShare, uint timeStamp);

    // Mutative functions
    function appendToDebtShareStorage(uint debtShare) external;

    function updateDebtShareStorage(uint index, uint debtShare) external;

    function removeDebtShareStorage(uint index) external;
}
