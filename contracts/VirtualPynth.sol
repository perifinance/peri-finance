pragma solidity 0.5.16;

// Inheritance
import "openzeppelin-solidity-2.3.0/contracts/token/ERC20/ERC20.sol";

// Libraries
import "./SafeDecimalMath.sol";

// Internal references
import "./interfaces/IPynth.sol";
import "./interfaces/IAddressResolver.sol";
import "./interfaces/IVirtualPynth.sol";
import "./interfaces/IExchanger.sol";
// Note: use OZ's IERC20 here as using ours will complain about conflicting names
// during the build
import "openzeppelin-solidity-2.3.0/contracts/token/ERC20/IERC20.sol";

// https://docs.peri.finance/contracts/source/contracts/virtualpynth
contract VirtualPynth is ERC20, IVirtualPynth {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    IERC20 public pynth;
    IAddressResolver public resolver;

    bool public settled = false;

    uint8 public constant decimals = 18;

    // track initial supply so we can calculate the rate even after all supply is burned
    uint public initialSupply;

    // track final settled amount of the pynth so we can calculate the rate after settlement
    uint public settledAmount;

    bytes32 public currencyKey;

    constructor(
        IERC20 _pynth,
        IAddressResolver _resolver,
        address _recipient,
        uint _amount,
        bytes32 _currencyKey
    ) public ERC20() {
        pynth = _pynth;
        resolver = _resolver;
        currencyKey = _currencyKey;

        // Assumption: the pynth will be issued to us within the same transaction,
        // and this supply matches that
        _mint(_recipient, _amount);

        initialSupply = _amount;
    }

    // INTERNALS

    function exchanger() internal view returns (IExchanger) {
        return IExchanger(resolver.requireAndGetAddress("Exchanger", "Exchanger contract not found"));
    }

    function secsLeft() internal view returns (uint) {
        return exchanger().maxSecsLeftInWaitingPeriod(address(this), currencyKey);
    }

    function calcRate() internal view returns (uint) {
        if (initialSupply == 0) {
            return 0;
        }

        uint pynthBalance;

        if (!settled) {
            pynthBalance = IERC20(address(pynth)).balanceOf(address(this));
            (uint reclaim, uint rebate, ) = exchanger().settlementOwing(address(this), currencyKey);

            if (reclaim > 0) {
                pynthBalance = pynthBalance.sub(reclaim);
            } else if (rebate > 0) {
                pynthBalance = pynthBalance.add(rebate);
            }
        } else {
            pynthBalance = settledAmount;
        }

        return pynthBalance.divideDecimalRound(initialSupply);
    }

    function balanceUnderlying(address account) internal view returns (uint) {
        uint vBalanceOfAccount = balanceOf(account);

        return vBalanceOfAccount.multiplyDecimalRound(calcRate());
    }

    function settlePynth() internal {
        if (settled) {
            return;
        }
        settled = true;

        exchanger().settle(address(this), currencyKey);

        settledAmount = IERC20(address(pynth)).balanceOf(address(this));

        emit Settled(totalSupply(), settledAmount);
    }

    // VIEWS

    function name() external view returns (string memory) {
        return string(abi.encodePacked("Virtual Pynth ", currencyKey));
    }

    function symbol() external view returns (string memory) {
        return string(abi.encodePacked("v", currencyKey));
    }

    // get the rate of the vPynth to the pynth.
    function rate() external view returns (uint) {
        return calcRate();
    }

    // show the balance of the underlying pynth that the given address has, given
    // their proportion of totalSupply
    function balanceOfUnderlying(address account) external view returns (uint) {
        return balanceUnderlying(account);
    }

    function secsLeftInWaitingPeriod() external view returns (uint) {
        return secsLeft();
    }

    function readyToSettle() external view returns (bool) {
        return secsLeft() == 0;
    }

    // PUBLIC FUNCTIONS

    // Perform settlement of the underlying exchange if required,
    // then burn the accounts vPynths and transfer them their owed balanceOfUnderlying
    function settle(address account) external {
        settlePynth();

        IERC20(address(pynth)).transfer(account, balanceUnderlying(account));

        _burn(account, balanceOf(account));
    }

    event Settled(uint totalSupply, uint amountAfterSettled);
}
