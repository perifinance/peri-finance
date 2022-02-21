pragma solidity 0.5.16;

interface ICrossChainState {
    struct CrossNetworkUserData {
        // total network debtLedgerIndex
        uint totalNetworkDebtLedgerIndex;
        // user state debtledgerIndex
        uint userStateDebtLedgerIndex;
    }

    // Views
    function totalNetworkDebtLedgerLength() external view returns (uint);

    function lastTotalNetworkDebtLedgerEntry() external view returns (uint);

    function getTotalNetworkDebtEntryAtIndex(uint) external view returns (uint);

    function getCrossNetworkUserData(address) external view returns (uint, uint);

    // Mutative functions
    function setCrossNetworkUserData(address, uint) external;

    function clearCrossNetworkUserData(address) external;

    function appendTotalNetworkDebtLedger(uint) external;

    function addTotalNetworkDebtLedger(uint amount) external;

    function subtractTotalNetworkDebtLedger(uint amount) external;

    function setCrosschain(bytes32 _chainID) external;

    function addCrosschain(bytes32 chainID) external;

    function setCrossNetworkIssuedDebt(bytes32 _chainID, uint _amount) external;

    function getCrossNetworkIssuedDebt(bytes32 _chainID) external view returns (uint);

    function setCrossNetworkActiveDebt(bytes32 _chainID, uint _amount) external;

    function getCrossNetworkActiveDebt(bytes32 _chainID) external view returns (uint);

    function setCrossNetworkIssuedDebtAll(bytes32[] calldata _chainIDs, uint[] calldata _amounts) external;

    function getCrossNetworkIssuedDebtAll() external view returns (uint);

    function setCrossNetworkActiveDebtAll(bytes32[] calldata _chainIDs, uint[] calldata _amounts) external;

    function getCrossNetworkActiveDebtAll() external view returns (uint);

    function setCrossNetworkDebtsAll(
        bytes32[] calldata _chainIDs,
        uint[] calldata _debts,
        uint[] calldata _activeDebts
    ) external;

    function getCurrentNetworkIssuedDebt() external view returns (uint);

    function getTotalNetworkIssuedDebt() external view returns (uint);

    function addIssuedDebt(bytes32 _chainID, uint _amount) external;

    function subtractIssuedDebt(bytes32 _chainID, uint _amount) external;

    function getChainID() external view returns (bytes32);
}
