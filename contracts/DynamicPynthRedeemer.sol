pragma solidity ^0.5.16;

// Inheritence
import "./Owned.sol";
import "./Proxyable.sol";
import "./MixinResolver.sol";
import "./interfaces/IDynamicPynthRedeemer.sol";

// Libraries
import "./SafeDecimalMath.sol";

// Internal references
import "./interfaces/IIssuer.sol";
import "./interfaces/IExchangeRates.sol";

contract DynamicPynthRedeemer is Owned, IDynamicPynthRedeemer, MixinResolver {
    using SafeDecimalMath for uint;

    bytes32 public constant CONTRACT_NAME = "DynamicPynthRedeemer";

    uint public discountRate;
    bool public redemptionActive;

    bytes32 internal constant pUSD = "pUSD";

    bytes32 private constant CONTRACT_ISSUER = "Issuer";
    bytes32 private constant CONTRACT_EXRATES = "ExchangeRates";

    constructor(address _owner, address _resolver) public Owned(_owner) MixinResolver(_resolver) {
        discountRate = SafeDecimalMath.unit();
    }

    /* ========== RESOLVER CONFIG ========== */

    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        addresses = new bytes32[](2);
        addresses[0] = CONTRACT_ISSUER;
        addresses[1] = CONTRACT_EXRATES;
    }

    /* ========== INTERNAL VIEWS ========== */

    function _issuer() internal view returns (IIssuer) {
        return IIssuer(requireAndGetAddress(CONTRACT_ISSUER));
    }

    function _exchangeRates() internal view returns (IExchangeRates) {
        return IExchangeRates(requireAndGetAddress(CONTRACT_EXRATES));
    }

    function _redeemingActive() internal view {
        require(redemptionActive, "Redemption deactivated");
    }

    /* ========== EXTERNAL VIEWS ========== */

    function getDiscountRate() external view returns (uint) {
        return discountRate;
    }

    /* ========== INTERNAL HELPERS ========== */

    function _proxyAddressForKey(bytes32 currencyKey) internal returns (address) {
        address pynth = address(_issuer().pynths(currencyKey));
        require(pynth != address(0), "Invalid pynth");
        return address(Proxyable(pynth).proxy());
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function redeemAll(bytes32[] calldata currencyKeys) external requireRedemptionActive {
        for (uint i = 0; i < currencyKeys.length; i++) {
            address pynthProxy = _proxyAddressForKey(currencyKeys[i]);
            _redeem(pynthProxy, currencyKeys[i], IERC20(pynthProxy).balanceOf(msg.sender));
        }
    }

    function redeem(bytes32 currencyKey) external requireRedemptionActive {
        address pynthProxy = _proxyAddressForKey(currencyKey);
        _redeem(pynthProxy, currencyKey, IERC20(pynthProxy).balanceOf(msg.sender));
    }

    function redeemPartial(bytes32 currencyKey, uint amountOfPynth) external requireRedemptionActive {
        address pynthProxy = _proxyAddressForKey(currencyKey);
        // technically this check isn't necessary - Pynth.burn would fail due to safe sub,
        // but this is a useful error message to the user
        require(IERC20(pynthProxy).balanceOf(msg.sender) >= amountOfPynth, "Insufficient balance");
        _redeem(pynthProxy, currencyKey, amountOfPynth);
    }

    function _redeem(
        address pynthProxy,
        bytes32 currencyKey,
        uint amountOfPynth
    ) internal {
        require(amountOfPynth > 0, "No balance of pynth to redeem");
        require(currencyKey != pUSD, "Cannot redeem pUSD");

        // Discount rate applied to chainlink price for dynamic redemptions
        (uint rate, bool invalid) = _exchangeRates().rateAndInvalid(currencyKey);
        uint rateToRedeem = rate.multiplyDecimalRound(discountRate);
        require(rateToRedeem > 0 && !invalid, "Pynth not redeemable");

        uint amountInpUSD = amountOfPynth.multiplyDecimalRound(rateToRedeem);
        _issuer().burnAndIssuePynthsWithoutDebtCache(msg.sender, currencyKey, amountOfPynth, amountInpUSD);

        emit PynthRedeemed(pynthProxy, msg.sender, amountOfPynth, amountInpUSD);
    }

    /* ========== MODIFIERS ========== */

    modifier requireRedemptionActive() {
        _redeemingActive();
        _;
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    function setDiscountRate(uint _newRate) external onlyOwner {
        require(_newRate >= 0 && _newRate <= SafeDecimalMath.unit(), "Invalid rate");
        discountRate = _newRate;
        emit DiscountRateUpdated(_newRate);
    }

    function suspendRedemption() external onlyOwner {
        require(redemptionActive, "Redemption suspended");
        redemptionActive = false;
        emit RedemptionSuspended();
    }

    function resumeRedemption() external onlyOwner {
        require(!redemptionActive, "Redemption not suspended");
        redemptionActive = true;
        emit RedemptionResumed();
    }

    /* ========== EVENTS ========== */

    event RedemptionSuspended();
    event RedemptionResumed();
    event DiscountRateUpdated(uint discountRate);
    event PynthRedeemed(address pynth, address account, uint amountOfPynth, uint amountInpUSD);
}
