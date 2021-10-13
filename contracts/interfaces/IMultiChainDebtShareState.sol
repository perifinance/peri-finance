pragma solidity 0.5.16;

interface IMultiChainDebtShareState {
    struct DebtShareStorage {
        // Indicates how much addtional debt should be added or subtracted
        // This should be only pUSD amount
        uint debtShare;
        // Indicates if the debtShare should be added or subtracted
        bool isDecreased;
        // When this data was added
        uint timeStamp;
    }

    // Views
    function debtShareStorageInfoAt(uint index)
        external
        view
        returns (
            uint debtShare,
            bool isDecreased,
            uint timeStamp
        );

    function debtShareStorageLength() external view returns (uint);

    function lastDebtShareStorageInfo()
        external
        view
        returns (
            uint debtShare,
            bool isDecreased,
            uint timeStamp
        );

    function lastDebtShareStorageIndex() external view returns (uint);

    // Mutative functions
    function appendToDebtShareStorage(uint debtShare, bool isDecreased) external;

    function updateDebtShareStorage(
        uint index,
        uint debtShare,
        bool isDecreased
    ) external;

    function removeDebtShareStorage(uint index) external;
}
