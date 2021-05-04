pragma solidity >=0.4.24;

// https://docs.peri.finance/contracts/source/interfaces/iperiFinancestate
interface IPeriFinanceState {
    // Views
    function debtLedger(uint index) external view returns (uint);

    function issuanceData(address account) external view returns (uint initialDebtOwnership, uint debtEntryIndex);

    function debtLedgerLength() external view returns (uint);

    function hasIssued(address account) external view returns (bool);

    function lastDebtLedgerEntry() external view returns (uint);

    // Mutative functions
    function incrementTotalIssuerCount() external;

    function decrementTotalIssuerCount() external;

    function setCurrentIssuanceData(address account, uint initialDebtOwnership) external;

    function appendDebtLedgerValue(uint value) external;

    function clearIssuanceData(address account) external;

    // Views
    function periDebtLedger(uint index) external view returns(uint);

    function periIssuanceData(address account) external view returns (uint initialDebtOwnership, uint debtEntryIndex);
    
    function periDebtLedgerLength() external view returns (uint);

    function hasPeriIssued(address account) external view returns (bool);

    function lastPeriDebtLedgerEntry() external view returns (uint);

    // Mutative functions
    function incrementTotalPeriIssuerCount() external;

    function decrementTotalPeriIssuerCount() external;
    
    function setCurrentPeriIssuanceData(address account, uint initialDebtOwnership) external;

    function appendPeriDebtLedgerValue(uint value) external;

    function clearPeriIssuanceData(address account) external;

}
