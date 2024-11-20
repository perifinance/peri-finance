pragma solidity ^0.5.16;

// Inheritence
import "./MixinResolver.sol";
import "./interfaces/IPynthRedeemer.sol";

// Libraries
import "./SafeDecimalMath.sol";

// Internal references
import "./interfaces/IERC20.sol";
import "./interfaces/IIssuer.sol";

contract PynthRedeemer is IPynthRedeemer, MixinResolver {
    using SafeDecimalMath for uint;

    bytes32 public constant CONTRACT_NAME = "PynthRedeemer";

    mapping(address => uint) public redemptions;

    bytes32 private constant CONTRACT_ISSUER = "Issuer";
    bytes32 private constant CONTRACT_PYNTHPUSD = "PynthpUSD";

    constructor(address _resolver) public MixinResolver(_resolver) {}

    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        addresses = new bytes32[](2);
        addresses[0] = CONTRACT_ISSUER;
        addresses[1] = CONTRACT_PYNTHPUSD;
    }

    function issuer() internal view returns (IIssuer) {
        return IIssuer(requireAndGetAddress(CONTRACT_ISSUER));
    }

    function pUSD() internal view returns (IERC20) {
        return IERC20(requireAndGetAddress(CONTRACT_PYNTHPUSD));
    }

    function totalSupply(IERC20 pynthProxy) public view returns (uint supplyInpUSD) {
        supplyInpUSD = pynthProxy.totalSupply().multiplyDecimal(redemptions[address(pynthProxy)]);
    }

    function balanceOf(IERC20 pynthProxy, address account) external view returns (uint balanceInpUSD) {
        balanceInpUSD = pynthProxy.balanceOf(account).multiplyDecimal(redemptions[address(pynthProxy)]);
    }

    function redeemAll(IERC20[] calldata pynthProxies) external {
        for (uint i = 0; i < pynthProxies.length; i++) {
            _redeem(pynthProxies[i], pynthProxies[i].balanceOf(msg.sender));
        }
    }

    function redeem(IERC20 pynthProxy) external {
        _redeem(pynthProxy, pynthProxy.balanceOf(msg.sender));
    }

    function redeemPartial(IERC20 pynthProxy, uint amountOfPynth) external {
        // technically this check isn't necessary - Pynth.burn would fail due to safe sub,
        // but this is a useful error message to the user
        require(pynthProxy.balanceOf(msg.sender) >= amountOfPynth, "Insufficient balance");
        _redeem(pynthProxy, amountOfPynth);
    }

    function _redeem(IERC20 pynthProxy, uint amountOfPynth) internal {
        uint rateToRedeem = redemptions[address(pynthProxy)];
        require(rateToRedeem > 0, "Pynth not redeemable");
        require(amountOfPynth > 0, "No balance of pynth to redeem");
        issuer().burnForRedemption(address(pynthProxy), msg.sender, amountOfPynth);
        uint amountInpUSD = amountOfPynth.multiplyDecimal(rateToRedeem);
        pUSD().transfer(msg.sender, amountInpUSD);
        emit PynthRedeemed(address(pynthProxy), msg.sender, amountOfPynth, amountInpUSD);
    }

    function deprecate(IERC20 pynthProxy, uint rateToRedeem) external onlyIssuer {
        address pynthProxyAddress = address(pynthProxy);
        require(redemptions[pynthProxyAddress] == 0, "Pynth is already deprecated");
        require(rateToRedeem > 0, "No rate for pynth to redeem");
        uint totalPynthSupply = pynthProxy.totalSupply();
        uint supplyInpUSD = totalPynthSupply.multiplyDecimal(rateToRedeem);
        require(pUSD().balanceOf(address(this)) >= supplyInpUSD, "pUSD must first be supplied");
        redemptions[pynthProxyAddress] = rateToRedeem;
        emit PynthDeprecated(address(pynthProxy), rateToRedeem, totalPynthSupply, supplyInpUSD);
    }

    function requireOnlyIssuer() internal view {
        require(msg.sender == address(issuer()), "Restricted to Issuer contract");
    }

    modifier onlyIssuer() {
        requireOnlyIssuer();
        _;
    }

    event PynthRedeemed(address pynth, address account, uint amountOfPynth, uint amountInpUSD);
    event PynthDeprecated(address pynth, uint rateToRedeem, uint totalPynthSupply, uint supplyInpUSD);
}
