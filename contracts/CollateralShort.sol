pragma solidity 0.5.16;

pragma experimental ABIEncoderV2;

// Inheritance
import "./Collateral.sol";

// Internal references
import "./CollateralState.sol";

contract CollateralShort is Collateral {
    constructor(
        CollateralState _state,
        address _owner,
        ICollateralManager _manager,
        address _resolver,
        bytes32 _collateralKey,
        uint _minCratio,
        uint _minCollateral
    ) public Collateral(_state, _owner, _manager, _resolver, _collateralKey, _minCratio, _minCollateral) {}

    function open(
        uint collateral,
        uint amount,
        bytes32 currency
    ) external {
        require(
            collateral <= IERC20(address(_pynthpUSD())).allowance(msg.sender, address(this)),
            "Allowance not high enough"
        );

        _open(collateral, amount, currency, true);

        IERC20(address(_pynthpUSD())).transferFrom(msg.sender, address(this), collateral);
    }

    function close(uint id) external {
        (uint amount, uint collateral) = _close(msg.sender, id);

        IERC20(address(_pynthpUSD())).transfer(msg.sender, collateral);
    }

    function deposit(
        address borrower,
        uint id,
        uint amount
    ) external {
        require(amount <= IERC20(address(_pynthpUSD())).allowance(msg.sender, address(this)), "Allowance not high enough");

        IERC20(address(_pynthpUSD())).transferFrom(msg.sender, address(this), amount);

        _deposit(borrower, id, amount);
    }

    function withdraw(uint id, uint amount) external {
        (uint withdrawnAmount, uint collateral) = _withdraw(id, amount);
        IERC20(address(_pynthpUSD())).transfer(msg.sender, withdrawnAmount);
    }

    function repay(
        address borrower,
        uint id,
        uint amount
    ) external {
        _repay(borrower, msg.sender, id, amount);
    }

    function draw(uint id, uint amount) external {
        _draw(id, amount);
    }

    function liquidate(
        address borrower,
        uint id,
        uint amount
    ) external {
        uint collateralLiquidated = _liquidate(borrower, id, amount);

        IERC20(address(_pynthpUSD())).transfer(msg.sender, collateralLiquidated);
    }

    function getReward(bytes32 currency, address account) external {
        if (shortingRewards[currency] != address(0)) {
            IShortingRewards(shortingRewards[currency]).getReward(account);
        }
    }
}
