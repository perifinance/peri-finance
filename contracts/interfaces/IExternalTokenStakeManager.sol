pragma solidity 0.5.16;

contract IExternalTokenStakeManager {
    // view
    function getTargetRatio(address _account, uint _existDebt)
        external
        view
        returns (
            uint,
            uint,
            uint
        );

    function exStakingRatio(address _account, uint existDebt) external view returns (uint, uint);

    function getRatios(
        address _account,
        uint _existDebt,
        uint _periCol
    )
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

    // function getAddDebtSA(address _account, uint _existDebt, uint _amount, uint _periCol, bytes32 _targetKey)
    //     external view returns (uint, uint, uint);

    function maxStakableAmountOf(
        address _account,
        uint _existDebt,
        uint _periCol,
        bytes32 _targetKey
    ) external view returns (uint);

    function calcTRatio(
        address _account,
        uint _existDebt,
        uint _periCol,
        bytes32 _targetKey
    )
        external
        view
        returns (
            uint,
            uint,
            uint
        );

    function maxExAmtToTRatio(
        address _account,
        uint _existDebt,
        bytes32 _unitKey
    ) external view returns (uint, uint);

    function burnAmtToFitTR(
        address _account,
        uint _existDebt,
        uint _periCol
    )
        external
        view
        returns (
            uint,
            uint,
            uint
        );

    function getExEADebt(address _account)
        external
        view
        returns (
            uint,
            uint,
            uint
        );

    function getExDebt(address _account) external view returns (uint);

    function getTokenList() external view returns (bytes32[] memory);

    function getTokenAddress(bytes32 _currencyKey) external view returns (address);

    function getTokenDecimals(bytes32 _currencyKey) external view returns (uint8);

    function getTokenActivation(bytes32 _currencyKey) external view returns (bool);

    function getCurrencyKeyOrder() external view returns (bytes32[] memory);

    function combinedStakedAmountOf(address _user, bytes32 _unitCurrency)
        external
        view
        returns (
            uint /* , uint */
        );

    function compiledStakableAmountOf(address _user, bytes32 _unitCurrency) external view returns (uint);

    function getTokenPUSDValueOf(address _user, bytes32 _currencyKey) external view returns (uint);

    function maxSAPulsTokensOf(address _user, bytes32 _currencyKey) external view returns (uint);

    function stakedAmountOf(
        address _user,
        bytes32 _currencyKey,
        bytes32 _unitCurrency
    ) external view returns (uint);

    function requireNotExceedsQuotaLimit(
        address _account,
        uint _debtBalance,
        uint _additionalpUSD,
        uint _additionalExToken,
        bool _isIssue
    ) external view;

    // function otherTokenIREA(address _account, bytes32 _targetKey) external view returns (uint, uint, uint, uint);

    // mutative
    function setTargetRatios(
        address _account,
        uint _tRatio,
        uint _exTRatio
    ) external;

    function calcInitTargetRatios(address _account, uint _periCol)
        external
        view
        returns (
            uint,
            uint,
            uint
        );

    function stakeToMaxExQuota(
        address _account,
        uint _existDebt,
        uint _periCol,
        bytes32 _targetKey
    ) external returns (uint);

    function stake(
        address _staker,
        uint _amount,
        uint _existDebt,
        uint _periCol,
        bytes32 _targetKey,
        bytes32 _unitKey
    ) external returns (uint);

    function unstake(
        address _unstaker,
        uint _amount,
        /* uint _curDebt,
        uint _periCol, */
        bytes32 _targetKey,
        bytes32 _unitKey
    ) external;

    function redeem(
        address account,
        uint amount,
        address liquidator
    ) external returns (uint);

    function unstakeToFitTR(
        address _staker,
        uint _existDebt,
        uint _periCol
    ) external returns (uint);

    function proRataUnstake(
        address _account,
        uint _amount,
        bytes32 _unitKey
    ) external returns (uint);

    /*     function unstakeAndLiquidate(
        address _unstaker,
        address _liquidator,
        uint _amount,
        bytes32 _targetCurrency,
        bytes32 _inputCurrency
    ) external; */

    function exit(address _from) external;
}
