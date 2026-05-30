import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BoxCubeIcon,
  ChevronDownIcon,
  GridIcon,
  HorizontaLDots,
  PieChartIcon,
  UserCircleIcon,
} from "../icons";
import { useSidebar } from "../context/SidebarContext";
import SidebarWidget from "./SidebarWidget";

type NavItem = {
  name: string;
  icon: React.ReactNode;
  path?: string;
  subItems?: { name: string; path: string }[];
};

const navItems: NavItem[] = [
  { icon: <GridIcon />, name: "Dashboard", path: "/" },
  { icon: <PieChartIcon />, name: "Trading", path: "/trading" },
  {
    icon: <BoxCubeIcon />,
    name: "Market Data",
    subItems: [
      { name: "Overview", path: "/market/overview" },
      { name: "Watchlist", path: "/market/watchlist" },
      { name: "News Sentiment", path: "/market/news" },
      { name: "Reddit Sentiment", path: "/market/reddit" },
    ],
  },
  {
    icon: <UserCircleIcon />,
    name: "Account",
    subItems: [
      { name: "Profile", path: "/account/profile" },
      { name: "Settings", path: "/account/settings" },
      { name: "API keys", path: "/account/authentication" },
    ],
  },
];

const AppSidebar: React.FC = () => {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered } = useSidebar();
  const location = useLocation();
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  const isActive = useCallback((path: string) => location.pathname === path, [location.pathname]);

  useEffect(() => {
    for (const nav of navItems) {
      if (nav.path && isActive(nav.path)) {
        setOpenSubmenu(null);
        return;
      }
      if (nav.subItems?.some((sub) => isActive(sub.path))) {
        setOpenSubmenu(nav.name);
        return;
      }
    }
  }, [location, isActive]);

  const renderSubmenu = (item: NavItem) => {
    if (!item.subItems) return null;
    const isOpen = openSubmenu === item.name;

    return (
      <li key={item.name}>
        <button
          type="button"
          onClick={() => setOpenSubmenu(isOpen ? null : item.name)}
          className={`menu-item group w-full ${
            isOpen ? "menu-item-active" : "menu-item-inactive"
          }`}
        >
          <span className={isOpen ? "menu-item-icon-active" : "menu-item-icon-inactive"}>
            {item.icon}
          </span>
          {(isExpanded || isHovered || isMobileOpen) && (
            <>
              <span className="menu-item-text flex-1 text-left">{item.name}</span>
              <ChevronDownIcon
                className={`w-5 h-5 transition-transform ${isOpen ? "rotate-180" : ""}`}
              />
            </>
          )}
        </button>
        {isOpen && (isExpanded || isHovered || isMobileOpen) && (
          <ul className="mt-2 ml-9 flex flex-col gap-1">
            {item.subItems.map((sub) => (
              <li key={sub.path}>
                <Link
                  to={sub.path}
                  className={`menu-dropdown-item ${
                    isActive(sub.path) ? "menu-dropdown-item-active" : "menu-dropdown-item-inactive"
                  }`}
                >
                  {sub.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <aside
      className={`fixed mt-16 flex flex-col lg:mt-0 top-0 px-5 left-0 bg-white dark:bg-gray-900 dark:border-gray-800 text-gray-900 h-screen transition-all duration-300 ease-in-out z-50 border-r border-gray-200 
        ${isExpanded || isMobileOpen ? "w-[290px]" : isHovered ? "w-[290px]" : "w-[90px]"}
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0`}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className={`py-8 flex ${!isExpanded && !isHovered ? "lg:justify-center" : "justify-start"}`}>
        <Link to="/">
          <span className="text-xl font-bold text-gray-800 dark:text-white">Inwest App</span>
        </Link>
      </div>
      <div className="flex flex-col overflow-y-auto duration-300 ease-linear no-scrollbar">
        <nav className="mb-6">
          <h2
            className={`mb-4 text-xs uppercase flex leading-[20px] text-gray-400 ${
              !isExpanded && !isHovered ? "lg:justify-center" : "justify-start"
            }`}
          >
            {isExpanded || isHovered || isMobileOpen ? "Menu" : <HorizontaLDots />}
          </h2>
          <ul className="flex flex-col gap-4">
            {navItems.map((nav) =>
              nav.subItems ? (
                renderSubmenu(nav)
              ) : (
                <li key={nav.name}>
                  {nav.path && (
                    <Link
                      to={nav.path}
                      className={`menu-item group ${
                        isActive(nav.path) ? "menu-item-active" : "menu-item-inactive"
                      }`}
                    >
                      <span
                        className={
                          isActive(nav.path) ? "menu-item-icon-active" : "menu-item-icon-inactive"
                        }
                      >
                        {nav.icon}
                      </span>
                      {(isExpanded || isHovered || isMobileOpen) && (
                        <span className="menu-item-text">{nav.name}</span>
                      )}
                    </Link>
                  )}
                </li>
              )
            )}
          </ul>
        </nav>
        {(isExpanded || isHovered || isMobileOpen) && <SidebarWidget />}
      </div>
    </aside>
  );
};

export default AppSidebar;
