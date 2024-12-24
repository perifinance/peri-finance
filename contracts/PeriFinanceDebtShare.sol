pragma solidity ^0.5.16;

// Inheritance
import "./Owned.sol";
import "./interfaces/IPeriFinanceDebtShare.sol";
import "./MixinResolver.sol";

// Libraries
import "./SafeDecimalMath.sol";

// https://docs.periFinance.io/contracts/source/contracts/periFinancedebtshare
contract PeriFinanceDebtShare is Owned, MixinResolver, IPeriFinanceDebtShare {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    struct PeriodBalance {
        uint128 amount;
        uint128 periodId;
    }

    bytes32 public constant CONTRACT_NAME = "PeriFinanceDebtShare";

    bytes32 private constant CONTRACT_ISSUER = "Issuer";

    uint internal constant MAX_PERIOD_ITERATE = 30;

    /* ========== STATE VARIABLES ========== */

    /**
     * Addresses selected by owner which are allowed to call `transferFrom` to manage debt shares
     */
    mapping(address => bool) public authorizedBrokers;

    /**
     * Addresses selected by owner which are allowed to call `takeSnapshot`
     * `takeSnapshot` is not public because only a small number of snapshots can be retained for a period of time, and so they
     * must be controlled to prevent censorship
     */
    mapping(address => bool) public authorizedToSnapshot;

    /**
     * Records a user's balance as it changes from period to period.
     * The last item in the array always represents the user's most recent balance
     * The intermediate balance is only recorded if
     * `currentPeriodId` differs (which would happen upon a call to `setCurrentPeriodId`)
     */
    mapping(address => PeriodBalance[]) public balances;

    /**
     * Records totalSupply as it changes from period to period
     * Similar to `balances`, the `totalSupplyOnPeriod` at index `currentPeriodId` matches the current total supply
     * Any other period ID would represent its most recent totalSupply before the period ID changed.
     */
    mapping(uint => uint) public totalSupplyOnPeriod;

    /* ERC20 fields. */
    string public name;
    string public symbol;
    uint8 public decimals;

    /**
     * Period ID used for recording accounting changes
     * Can only increment
     */
    uint128 public currentPeriodId;

    /**
     * Prevents the owner from making further changes to debt shares after initial import
     */
    bool public isInitialized = false;

    constructor(address _owner, address _resolver) public Owned(_owner) MixinResolver(_resolver) {
        name = "PeriFinance Debt Shares";
        symbol = "SDS";
        decimals = 18;

        // NOTE: must match initial fee period ID on `FeePool` constructor if issuer wont report
        currentPeriodId = 1;
    }

    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        addresses = new bytes32[](1);
        addresses[0] = CONTRACT_ISSUER;
    }

    /* ========== VIEWS ========== */

    function balanceOf(address account) public view returns (uint) {
        uint accountPeriodHistoryCount = balances[account].length;

        if (accountPeriodHistoryCount == 0) {
            return 0;
        }

        uint bal = uint(balances[account][accountPeriodHistoryCount - 1].amount);

        return uint(balances[account][accountPeriodHistoryCount - 1].amount);
    }

    function balanceOfOnPeriod(address account, uint periodId) public view returns (uint) {
        uint accountPeriodHistoryCount = balances[account].length;

        int oldestHistoryIterate =
            int(MAX_PERIOD_ITERATE < accountPeriodHistoryCount ? accountPeriodHistoryCount - MAX_PERIOD_ITERATE : 0);
        int i;
        for (i = int(accountPeriodHistoryCount) - 1; i >= oldestHistoryIterate; i--) {
            if (balances[account][uint(i)].periodId <= periodId) {
                return uint(balances[account][uint(i)].amount);
            }
        }

        require(i < 0, "PeriFinanceDebtShare: not found in recent history");
        return 0;
    }

    function totalSupply() public view returns (uint) {
        return totalSupplyOnPeriod[currentPeriodId];
    }

    function sharePercent(address account) external view returns (uint) {
        return sharePercentOnPeriod(account, currentPeriodId);
    }

    function sharePercentOnPeriod(address account, uint periodId) public view returns (uint) {
        uint balance = balanceOfOnPeriod(account, periodId);

        if (balance == 0) {
            return 0;
        }

        if(totalSupplyOnPeriod[periodId] == 0){
            return 0;
        }

  //      require(totalSupplyOnPeriod[periodId] > 0, uint2str(periodId));

        return balance.divideDecimal(totalSupplyOnPeriod[periodId]);
    }

    function allowance(address, address spender) public view returns (uint) {
        if (authorizedBrokers[spender]) {
            return uint(-1);
        } else {
            return 0;
        }
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function addAuthorizedBroker(address target) external onlyOwner {
        authorizedBrokers[target] = true;
        emit ChangeAuthorizedBroker(target, true);
    }

    function removeAuthorizedBroker(address target) external onlyOwner {
        authorizedBrokers[target] = false;
        emit ChangeAuthorizedBroker(target, false);
    }

    function addAuthorizedToSnapshot(address target) external onlyOwner {
        authorizedToSnapshot[target] = true;
        emit ChangeAuthorizedToSnapshot(target, true);
    }

    function removeAuthorizedToSnapshot(address target) external onlyOwner {
        authorizedToSnapshot[target] = false;
        emit ChangeAuthorizedToSnapshot(target, false);
    }

    function takeSnapshot(uint128 id) external onlyAuthorizedToSnapshot {
        require(id > currentPeriodId, "period id must always increase");
        totalSupplyOnPeriod[id] = totalSupplyOnPeriod[currentPeriodId];
        currentPeriodId = id;
    }



function uint2str(uint _i) internal pure returns (string memory _uintAsString) {
        if (_i == 0) {
            return "0";
        }
        uint j = _i;
        uint len;
        while (j != 0) {
            len++;
            j /= 10;
        }
        bytes memory bstr = new bytes(len);
        uint k = len;
        while (_i != 0) {
            k = k-1;
            uint8 temp = (48 + uint8(_i - _i / 10 * 10));
            bytes1 b1 = bytes1(temp);
            bstr[k] = b1;
            _i /= 10;
        }
        return string(bstr);
    }




function toString(address account) public pure returns(string memory) {
    return toString(abi.encodePacked(account));
}

function toString(uint256 value) public pure returns(string memory) {
    return toString(abi.encodePacked(value));
}

function toString(bytes32 value) public pure returns(string memory) {
    return toString(abi.encodePacked(value));
}

function toString(bytes memory data) public pure returns(string memory) {
    bytes memory alphabet = "0123456789abcdef";

    bytes memory str = new bytes(2 + data.length * 2);
    str[0] = "0";
    str[1] = "x";
    for (uint i = 0; i < data.length; i++) {
        str[2+i*2] = alphabet[uint(uint8(data[i] >> 4))];
        str[3+i*2] = alphabet[uint(uint8(data[i] & 0x0f))];
    }
    return string(str);
}


    function mintShare(address account, uint256 amount) external onlyIssuer {
        require(account != address(0), "ERC20: mint to the zero address");

        
        _increaseBalance(account, amount);

        totalSupplyOnPeriod[currentPeriodId] = totalSupplyOnPeriod[currentPeriodId].add(amount);

        emit Transfer(address(0), account, amount);
        emit Mint(account, amount);
    }

    function burnShare(address account, uint256 amount) external onlyIssuer {
        require(account != address(0), "ERC20: burn from zero address");

        _deductBalance(account, amount);

        totalSupplyOnPeriod[currentPeriodId] = totalSupplyOnPeriod[currentPeriodId].sub(amount);
        emit Transfer(account, address(0), amount);
        emit Burn(account, amount);
    }

    function approve(address, uint256) external pure returns (bool) {
        revert("debt shares are not transferrable");
    }

    function transfer(address, uint256) external pure returns (bool) {
        revert("debt shares are not transferrable");
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external onlyAuthorizedBrokers returns (bool) {
        require(to != address(0), "ERC20: send to the zero address");

        _deductBalance(from, amount);
        _increaseBalance(to, amount);

        emit Transfer(address(from), address(to), amount);

        return true;
    }

    function importAddresses(address[] calldata accounts, uint256[] calldata amounts) external onlyOwner onlySetup {
        uint supply = totalSupplyOnPeriod[currentPeriodId];

        for (uint i = 0; i < accounts.length; i++) {
            uint curBalance = balanceOf(accounts[i]);
            if (curBalance < amounts[i]) {
                uint amount = amounts[i] - curBalance;
                _increaseBalance(accounts[i], amount);
                supply = supply.add(amount);
                emit Mint(accounts[i], amount);
                emit Transfer(address(0), accounts[i], amount);
            } else if (curBalance > amounts[i]) {
                uint amount = curBalance - amounts[i];
                _deductBalance(accounts[i], amount);
                supply = supply.sub(amount);
                emit Burn(accounts[i], amount);
                emit Transfer(accounts[i], address(0), amount);
            }
        }

        totalSupplyOnPeriod[currentPeriodId] = supply;
    }

    function finishSetup() external onlyOwner {
        isInitialized = true;
    }

    /* ========== INTERNAL FUNCTIONS ======== */
    function _increaseBalance(address account, uint amount) internal {
        uint accountBalanceCount = balances[account].length;

        if (accountBalanceCount == 0) {
            balances[account].push(PeriodBalance(uint128(amount), uint128(currentPeriodId)));
        } else {
            uint128 newAmount = uint128(uint(balances[account][accountBalanceCount - 1].amount).add(amount));

            if (balances[account][accountBalanceCount - 1].periodId != currentPeriodId) {
                balances[account].push(PeriodBalance(newAmount, currentPeriodId));
            } else {
                balances[account][accountBalanceCount - 1].amount = newAmount;
            }
        }
    }

    function _deductBalance(address account, uint amount) internal {
        uint accountBalanceCount = balances[account].length;

        require(accountBalanceCount != 0, "PeriFinanceDebtShare: account has no share to deduct");

        uint128 newAmount = uint128(uint(balances[account][accountBalanceCount - 1].amount).sub(amount));

        

        if (balances[account][accountBalanceCount - 1].periodId != currentPeriodId) {
            balances[account].push(PeriodBalance(newAmount, currentPeriodId));
        } else {
            balances[account][accountBalanceCount - 1].amount = newAmount;
        }
    }

    /* ========== MODIFIERS ========== */

    modifier onlyIssuer() {
        require(msg.sender == requireAndGetAddress(CONTRACT_ISSUER), "PeriFinanceDebtShare: only issuer can mint/burn");
        _;
    }

    modifier onlyAuthorizedToSnapshot() {
        require(
            authorizedToSnapshot[msg.sender] || msg.sender == requireAndGetAddress(CONTRACT_ISSUER),
            "PeriFinanceDebtShare: not authorized to snapshot"
        );
        _;
    }

    modifier onlyAuthorizedBrokers() {
        require(authorizedBrokers[msg.sender], "PeriFinanceDebtShare: only brokers can transferFrom");
        _;
    }

    modifier onlySetup() {
        require(!isInitialized, "PeriFinanceDebt: only callable while still initializing");
        _;
    }

    /* ========== EVENTS ========== */
    event Mint(address indexed account, uint amount);
    event Burn(address indexed account, uint amount);
    event Transfer(address indexed from, address indexed to, uint value);

    event ChangeAuthorizedBroker(address indexed authorizedBroker, bool authorized);
    event ChangeAuthorizedToSnapshot(address indexed authorizedToSnapshot, bool authorized);
}
