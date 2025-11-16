interface SignInLayoutProps {
    children: React.ReactNode;
}; // since a layout should be reusable, SignInLayout shouldn't override SignInPage, therefore it becomes an interface

const SignInLayout = ({children}: SignInLayoutProps) => {
    return (
        <div className="flex flex-col">
            <nav className="bg-pink-300 h-10">
                <p>Navbar</p>
            </nav>
            {children}
        </div>
    );
};

export default SignInLayout;