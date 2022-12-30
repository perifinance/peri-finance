pragma solidity 0.5.16;

contract IExternalTokenStakeManager {
    // view
    function getTokenList() external view returns (bytes32[] memory);

    function getTokenAddress(bytes32 _currencyKey) external view returns (address);

    function getTokenDecimals(bytes32 _currencyKey) external view returns (uint8);

    function getTokenActivation(bytes32 _currencyKey) external view returns (bool);

    function getCurrencyKeyOrder() external view returns (bytes32[] memory);

    function combinedStakedAmountOf(address _user, bytes32 _unitCurrency) external view returns (uint);

    function compiledStakableAmountOf(address _user, bytes32 _unitCurrency) external view returns (uint);

    function getTokenPUSDValueOf(address _user, bytes32 _currencyKey) external view returns (uint);

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

    function externalTokenQuota(
        address _account,
        uint _debtBalance,
        uint _additionalpUSD,
        uint _additionalExToken,
        bool _isIssue
    ) external view returns (uint);

    // mutative
    function stake(
        address _staker,
        uint _amount,
        bytes32 _targetCurrency,
        bytes32 _inputCurrency
    ) external;

    function unstake(
        address _unstaker,
        uint _amount,
        bytes32 _targetCurrency,
        bytes32 _inputCurrency
    ) external;

    function redeem(
        address account,
        uint totalRedeemed,
        address liquidator
    ) external returns (uint);

    function unstakeMultipleTokens(
        address _unstaker,
        uint _amount,
        bytes32 _inputCurrency
    ) external;

    function unstakeAndLiquidate(
        address _unstaker,
        address _liquidator,
        uint _amount,
        bytes32 _targetCurrency,
        bytes32 _inputCurrency
    ) external;

    function exit(address _from) external;
}
