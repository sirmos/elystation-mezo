// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ElyPay
/// @notice Payment links for MUSD. Money goes from the payer to the receiver.
/// The contract never holds funds.
contract ElyPay is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Link {
        address owner;
        uint256 amount; // 0 means the payer picks the amount
        bool active;
        uint32 payments;
        uint256 totalReceived;
        string memo;
    }

    IERC20 public immutable usdc;
    address public treasury;
    uint16 public feeBps;
    uint16 public constant MAX_FEE_BPS = 100; // 1%
    uint256 public nextId = 1;
    mapping(uint256 => Link) public links;

    event LinkCreated(uint256 indexed id, address indexed owner, uint256 amount, string memo);
    event LinkStatus(uint256 indexed id, bool active);
    event Paid(
        uint256 indexed id,
        address indexed payer,
        address indexed receiver,
        uint256 amount,
        uint256 fee
    );
    event FeeChanged(uint16 feeBps);
    event TreasuryChanged(address treasury);

    constructor(address _usdc, address _treasury, uint16 _feeBps) Ownable(msg.sender) {
        require(_usdc != address(0) && _treasury != address(0), "Zero address");
        require(_feeBps <= MAX_FEE_BPS, "Fee too high");
        usdc = IERC20(_usdc);
        treasury = _treasury;
        feeBps = _feeBps;
    }

    function createLink(uint256 amount, string calldata memo) external returns (uint256 id) {
        require(bytes(memo).length <= 140, "Note too long");
        id = nextId++;
        links[id] = Link({
            owner: msg.sender,
            amount: amount,
            active: true,
            payments: 0,
            totalReceived: 0,
            memo: memo
        });
        emit LinkCreated(id, msg.sender, amount, memo);
    }

    function setActive(uint256 id, bool active) external {
        require(links[id].owner == msg.sender, "Not your link");
        links[id].active = active;
        emit LinkStatus(id, active);
    }

    /// @notice Pay a link. If the link has a fixed amount, the `amount` argument is ignored.
    function pay(uint256 id, uint256 amount) external nonReentrant {
        Link storage l = links[id];
        require(l.owner != address(0), "No such link");
        require(l.active, "Link is off");

        uint256 total = l.amount == 0 ? amount : l.amount;
        require(total > 0, "Amount is zero");

        uint256 fee = (total * feeBps) / 10_000;
        uint256 net = total - fee;

        l.payments += 1;
        l.totalReceived += net;
        emit Paid(id, msg.sender, l.owner, total, fee);

        if (fee > 0) {
            usdc.safeTransferFrom(msg.sender, treasury, fee);
        }
        usdc.safeTransferFrom(msg.sender, l.owner, net);
    }

    function setFee(uint16 _feeBps) external onlyOwner {
        require(_feeBps <= MAX_FEE_BPS, "Fee too high");
        feeBps = _feeBps;
        emit FeeChanged(_feeBps);
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Zero address");
        treasury = _treasury;
        emit TreasuryChanged(_treasury);
    }
}