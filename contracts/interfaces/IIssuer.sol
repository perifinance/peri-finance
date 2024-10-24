pragma solidity >=0.4.24;

import "../interfaces/IPynth.sol";

interface IIssuer {
    // Views

    // function allNetworksDebtInfo()
    //     external
    //     view
    //     returns (
    //         uint256 debt,
    //         uint256 sharesSupply,
    //         bool isStale
    //     );

    //function anyPynthOrPERIRateIsInvalid() external view returns (bool anyRateInvalid);

    function availableCurrencyKeys() external view returns (bytes32[] memory);

    function availablePynthCount() external view returns (uint);

    function availablePynths(uint index) external view returns (IPynth);

    function canBurnPynths(address account) external view returns (bool);

    function collateral(address account) external view returns (uint);

    function collateralisationRatio(address issuer) external view returns (uint);

    function collateralisationRatioAndAnyRatesInvalid(address _issuer)
        external
        view
        returns (uint cratio, bool anyRateIsInvalid);

    function debtBalanceOf(address issuer, bytes32 currencyKey) external view returns (uint debtBalance);

    function issuanceRatio() external view returns (uint);

    function lastIssueEvent(address account) external view returns (uint);

    function maxIssuablePynths(address issuer)
        external
        view
        returns (
            uint,
            uint,
            uint
        );

    // function externalTokenQuota(
    //     address _account,
    //     uint _addtionalpUSD,
    //     uint _addtionalExToken,
    //     bool _isIssue
    // ) external view returns (uint);

    function minimumStakeTime() external view returns (uint);

    function remainingIssuablePynths(address issuer)
        external
        view
        returns (
            uint maxIssuable,
            uint alreadyIssued,
            uint totalSystemDebt
        );

    function pynths(bytes32 currencyKey) external view returns (IPynth);

    function getPynths(bytes32[] calldata currencyKeys) external view returns (IPynth[] memory);

    function pynthsByAddress(address pynthAddress) external view returns (bytes32);

    function totalIssuedPynths(bytes32 currencyKey, bool excludeEtherCollateral) external view returns (uint, bool);

    function transferablePeriFinanceAndAnyRateIsInvalid(address account, uint balance)
        external
        view
        returns (uint transferable, bool anyRateIsInvalid);

    function amountsToFitClaimable(address _account) external view returns (uint burnAmount, uint exTokenAmountToUnstake);

    // function liquidationAmounts(address account, bool isSelfLiquidation)
    //     external
    //     view
    //     returns (
    //         uint totalRedeemed,
    //         uint debtToRemove,
    //         uint escrowToLiquidate,
    //         uint initialDebtBalance
    //     );

    // Restricted: used internally to PERIFinance
    function addPynths(IPynth[] calldata pynthsToAdd) external;

    function issuePynths(
        address _issuer,
        bytes32 _currencyKey,
        uint _issueAmount
    ) external;

    function issueMaxPynths(address _issuer) external;

    function issuePynthsToMaxQuota(address _issuer, bytes32 _currencyKey) external;

    function burnPynths(
        address _from,
        bytes32 _currencyKey,
        uint _burnAmount
    ) external;

    function fitToClaimable(address _from) external;

    function exit(address _from) external;

    function liquidateDelinquentAccount(
        address account,
        uint pusdAmount,
        address liquidator
    ) external returns (uint totalRedeemed, uint amountToLiquidate);

    // function issuePynthsOnBehalf(
    //     address issueFor,
    //     address from,
    //     uint amount
    // ) external;

    // function issueMaxPynthsOnBehalf(address issueFor, address from) external;

    // function burnPynthsOnBehalf(
    //     address burnForAddress,
    //     address from,
    //     uint amount
    // ) external;

    // function burnPynthsToTarget(address from) external;

    // function burnPynthsToTargetOnBehalf(address burnForAddress, address from) external;

    // function burnForRedemption(
    //     address deprecatedPynthProxy,
    //     address account,
    //     uint balance
    // ) external;

    //function setCurrentPeriodId(uint128 periodId) external;

    // function liquidateAccount(address account, bool isSelfLiquidation)
    //     external
    //     returns (
    //         uint totalRedeemed,
    //         uint debtRemoved,
    //         uint escrowToLiquidate
    //     );

    // function issuePynthsWithoutDebt(
    //     bytes32 currencyKey,
    //     address to,
    //     uint amount
    // ) external returns (bool rateInvalid);

    // function burnPynthsWithoutDebt(
    //     bytes32 currencyKey,
    //     address to,
    //     uint amount
    // ) external returns (bool rateInvalid);

    // function burnAndIssuePynthsWithoutDebtCache(
    //     address account,
    //     bytes32 currencyKey,
    //     uint amountOfPynth,
    //     uint amountInpUSD
    // ) external;

    //function modifyDebtSharesForMigration(address account, uint amount) external;

    function getRatios(address _account, bool _checkRate)
        external
        view
        returns (
            uint,
            uint,
            uint,
            uint,
            uint,
            uint
        );

    function getTargetRatio(address account) external view returns (uint);
}
