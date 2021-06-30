pragma solidity 0.5.16;

interface ICollateralManager {
    // Manager information
    function hasCollateral(address collateral) external view returns (bool);

    function isPynthManaged(bytes32 currencyKey) external view returns (bool);

    // State information
    function long(bytes32 pynth) external view returns (uint amount);

    function short(bytes32 pynth) external view returns (uint amount);

    function totalLong() external view returns (uint pusdValue, bool anyRateIsInvalid);

    function totalShort() external view returns (uint pusdValue, bool anyRateIsInvalid);

    function getBorrowRate() external view returns (uint borrowRate, bool anyRateIsInvalid);

    function getShortRate(bytes32 pynth) external view returns (uint shortRate, bool rateIsInvalid);

    function getRatesAndTime(uint index)
        external
        view
        returns (
            uint entryRate,
            uint lastRate,
            uint lastUpdated,
            uint newIndex
        );

    function getShortRatesAndTime(bytes32 currency, uint index)
        external
        view
        returns (
            uint entryRate,
            uint lastRate,
            uint lastUpdated,
            uint newIndex
        );

    function exceedsDebtLimit(uint amount, bytes32 currency) external view returns (bool canIssue, bool anyRateIsInvalid);

    function arePynthsAndCurrenciesSet(bytes32[] calldata requiredPynthNamesInResolver, bytes32[] calldata pynthKeys)
        external
        view
        returns (bool);

    function areShortablePynthsSet(bytes32[] calldata requiredPynthNamesInResolver, bytes32[] calldata pynthKeys)
        external
        view
        returns (bool);

    // Loans
    function getNewLoanId() external returns (uint id);

    // Manager mutative
    function addCollaterals(address[] calldata collaterals) external;

    function removeCollaterals(address[] calldata collaterals) external;

    function addPynths(bytes32[] calldata pynthNamesInResolver, bytes32[] calldata pynthKeys) external;

    function removePynths(bytes32[] calldata pynths, bytes32[] calldata pynthKeys) external;

    function addShortablePynths(bytes32[2][] calldata requiredPynthAndInverseNamesInResolver, bytes32[] calldata pynthKeys)
        external;

    function removeShortablePynths(bytes32[] calldata pynths) external;

    // State mutative
    function updateBorrowRates(uint rate) external;

    function updateShortRates(bytes32 currency, uint rate) external;

    function incrementLongs(bytes32 pynth, uint amount) external;

    function decrementLongs(bytes32 pynth, uint amount) external;

    function incrementShorts(bytes32 pynth, uint amount) external;

    function decrementShorts(bytes32 pynth, uint amount) external;
}
