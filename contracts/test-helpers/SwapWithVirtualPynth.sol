pragma solidity 0.5.16;

// Inheritance
import "openzeppelin-solidity-2.3.0/contracts/token/ERC20/ERC20.sol";

// Libraries
import "../SafeDecimalMath.sol";

// Internal references
import "../interfaces/IPeriFinance.sol";
import "../interfaces/IAddressResolver.sol";
import "../interfaces/IVirtualPynth.sol";
import "../interfaces/IExchanger.sol";

interface IERC20Detailed {
    // ERC20 Optional Views
    function name() external view returns (string memory);

    function symbol() external view returns (string memory);

    function decimals() external view returns (uint8);

    // Views
    function totalSupply() external view returns (uint);

    function balanceOf(address owner) external view returns (uint);

    function allowance(address owner, address spender) external view returns (uint);

    // Mutative functions
    function transfer(address to, uint value) external returns (bool);

    function approve(address spender, uint value) external returns (bool);

    function transferFrom(
        address from,
        address to,
        uint value
    ) external returns (bool);

    // Events
    event Transfer(address indexed from, address indexed to, uint value);

    event Approval(address indexed owner, address indexed spender, uint value);
}

interface ICurvePool {
    function exchange(
        int128 i,
        int128 j,
        uint dx,
        uint min_dy
    ) external;
}

contract VirtualToken is ERC20 {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    IVirtualPynth public vPynth;
    ICurvePool public pool;
    IERC20Detailed public targetToken;

    constructor(
        IVirtualPynth _vPynth,
        ICurvePool _pool,
        IERC20Detailed _targetToken
    ) public ERC20() {
        vPynth = _vPynth;
        pool = _pool;
        targetToken = _targetToken;
    }

    function _pynthBalance() internal view returns (uint) {
        return IERC20(address(vPynth.pynth())).balanceOf(address(this));
    }

    function name() external view returns (string memory) {
        return string(abi.encodePacked("Virtual Token ", targetToken.name()));
    }

    function symbol() external view returns (string memory) {
        return string(abi.encodePacked("v", targetToken.symbol()));
    }

    function decimals() external view returns (uint8) {
        return IERC20Detailed(address(vPynth.pynth())).decimals();
    }

    function convert(address account, uint amount) external {
        // transfer the vPynth from the creating contract to me
        IERC20(address(vPynth)).transferFrom(msg.sender, address(this), amount);

        // now mint the same supply to the user
        _mint(account, amount);

        emit Converted(address(vPynth), amount);
    }

    function internalSettle() internal {
        if (vPynth.settled()) {
            return;
        }

        require(vPynth.readyToSettle(), "Not yet ready to settle");

        IERC20 pynth = IERC20(address(vPynth.pynth()));

        // settle all vPynths for this vToken (now I have pynths)
        vPynth.settle(address(this));

        uint balanceAfterSettlement = pynth.balanceOf(address(this));

        emit Settled(totalSupply(), balanceAfterSettlement);

        // allow the pool to spend my pynths
        pynth.approve(address(pool), balanceAfterSettlement);

        // now exchange all my pynths (pBTC) for WBTC
        pool.exchange(2, 1, balanceAfterSettlement, 0);
    }

    function settle(address account) external {
        internalSettle();

        uint remainingTokenBalance = targetToken.balanceOf(address(this));

        uint accountBalance = balanceOf(account);

        // now determine how much of the proceeds the user should receive
        uint amount = accountBalance.divideDecimalRound(totalSupply()).multiplyDecimalRound(remainingTokenBalance);

        // burn these vTokens
        _burn(account, accountBalance);

        // finally, send the targetToken to the originator
        targetToken.transfer(account, amount);
    }

    event Converted(address indexed virtualPynth, uint amount);
    event Settled(uint totalSupply, uint amountAfterSettled);
}

contract SwapWithVirtualPynth {
    ICurvePool public incomingPool = ICurvePool(0xA5407eAE9Ba41422680e2e00537571bcC53efBfD); // Curve: pUSD v2 Swap
    ICurvePool public outgoingPool = ICurvePool(0x7fC77b5c7614E1533320Ea6DDc2Eb61fa00A9714); // Curve: pBTC Swap

    IPeriFinance public periFinance = IPeriFinance(0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F);

    IERC20Detailed public pUSD = IERC20Detailed(0x57Ab1ec28D129707052df4dF418D58a2D46d5f51);
    IERC20Detailed public USDC = IERC20Detailed(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);
    IERC20Detailed public WBTC = IERC20Detailed(0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599);

    function usdcToWBTC(uint amount) external {
        // get user's USDC into this contract
        USDC.transferFrom(msg.sender, address(this), amount);

        // ensure the pool can transferFrom our contract
        USDC.approve(address(incomingPool), amount);

        // now invoke curve USDC to pUSD
        incomingPool.exchange(1, 3, amount, 0);

        // now exchange my pUSD to pBTC
        (, IVirtualPynth vPynth) =
            periFinance.exchangeWithVirtual("pUSD", pUSD.balanceOf(address(this)), "pBTC", bytes32(0));

        // wrap this vPynth in a new token ERC20 contract
        VirtualToken vToken = new VirtualToken(vPynth, outgoingPool, WBTC);

        IERC20 vPynthAsERC20 = IERC20(address(vPynth));

        // get the balance of vPynths I now have
        uint vPynthBalance = vPynthAsERC20.balanceOf(address(this));

        // approve vToken to spend those vPynths
        vPynthAsERC20.approve(address(vToken), vPynthBalance);

        // now have the vToken transfer itself the vPynths and mint the entire vToken supply to the user
        vToken.convert(msg.sender, vPynthBalance);

        emit VirtualTokenCreated(address(vToken), vPynthBalance);
    }

    event VirtualTokenCreated(address indexed vToken, uint totalSupply);
}
