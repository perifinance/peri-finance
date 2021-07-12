pragma solidity 0.5.16;

import "./IERC20.sol";

interface IStakingState {
    // Mutative
    function stake(
        bytes32 _currencyKey,
        address _account,
        uint _amount
    ) external;

    function unstake(
        bytes32 _currencyKey,
        address _account,
        uint _amount
    ) external;

    function refund(
        bytes32 _currencyKey,
        address _account,
        uint _amount
    ) external returns (bool);

    // View
    function targetTokens(bytes32 _currencyKey)
        external
        view
        returns (
            address tokenAddress,
            uint8 decimals,
            bool activated
        );

    function stakedAmountOf(bytes32 _currencyKey, address _account) external view returns (uint);

    function totalStakedAmount(bytes32 _currencyKey) external view returns (uint);

    function totalStakerCount(bytes32 _currencyKey) external view returns (uint);

    function tokenList(uint _index) external view returns (bytes32);

    function tokenAddress(bytes32 _currencyKey) external view returns (address);

    function tokenDecimals(bytes32 _currencyKey) external view returns (uint8);

    function tokenActivated(bytes32 _currencyKey) external view returns (bool);

    function getTokenCurrencyKeys() external view returns (bytes32[] memory);
}
