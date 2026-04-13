"""
Authentication router.

Endpoints:
  POST /api/v1/auth/register  — create a new user account
  POST /api/v1/auth/login     — authenticate and get JWT token
  GET  /api/v1/auth/me        — get current authenticated user
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from typing import Optional

try:
    from typing import Annotated
except ImportError:  # Python < 3.9
    from typing_extensions import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import User

# ── Config ────────────────────────────────────────────────────────────────────

settings = get_settings()
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7

# 12 pleasant avatar colors
AVATAR_COLORS = [
    "#4F46E5", "#7C3AED", "#DB2777", "#DC2626",
    "#D97706", "#059669", "#0891B2", "#2563EB",
    "#7E22CE", "#BE185D", "#047857", "#0369A1",
]

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class UserPublic(BaseModel):
    id: int
    username: str
    email: str
    full_name: str
    avatar_color: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    full_name: str
    password: str
    confirm_password: str

    @field_validator("username")
    @classmethod
    def username_valid(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 3:
            raise ValueError("Tên đăng nhập phải có ít nhất 3 ký tự")
        if not v.replace("_", "").replace("-", "").replace(".", "").isalnum():
            raise ValueError("Tên đăng nhập chỉ được chứa chữ cái, số, dấu gạch dưới, gạch ngang và dấu chấm")
        return v

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Mật khẩu phải có ít nhất 8 ký tự")
        return v

    @field_validator("confirm_password")
    @classmethod
    def passwords_match(cls, v: str, info) -> str:
        if "password" in info.data and v != info.data["password"]:
            raise ValueError("Mật khẩu xác nhận không khớp")
        return v


class LoginRequest(BaseModel):
    """JSON body login (alternative to form-based OAuth2)."""
    identifier: str   # username or email
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


# ── Helpers ───────────────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def get_user_from_token(
    token: Annotated[Optional[str], Depends(oauth2_scheme)],
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Returns User if token is valid, else None (soft dependency)."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            return None
    except JWTError:
        return None
    return db.get(User, int(user_id))


def require_user(
    current_user: Annotated[Optional[User], Depends(get_user_from_token)],
) -> User:
    """Hard dependency — raises 401 if not authenticated."""
    if current_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bạn chưa đăng nhập hoặc phiên đã hết hạn",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not current_user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tài khoản đã bị vô hiệu hóa")
    return current_user


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    """Register a new user account and return a JWT token immediately."""
    # Check duplicates
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=400, detail="Tên đăng nhập đã được sử dụng")
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=400, detail="Email này đã được đăng ký")

    user = User(
        username=body.username,
        email=body.email,
        full_name=body.full_name.strip(),
        hashed_password=hash_password(body.password),
        avatar_color=random.choice(AVATAR_COLORS),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)
    return TokenResponse(access_token=token, user=UserPublic.model_validate(user))


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    """Login with username/email + password and return a JWT token."""
    # Look up by username or email
    user = (
        db.query(User).filter(User.username == body.identifier).first()
        or db.query(User).filter(User.email == body.identifier).first()
    )
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tên đăng nhập / email hoặc mật khẩu không đúng",
        )
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Tài khoản đã bị vô hiệu hóa")

    token = create_access_token(user.id)
    return TokenResponse(access_token=token, user=UserPublic.model_validate(user))


@router.post("/login/form", response_model=TokenResponse, include_in_schema=False)
def login_form(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """OAuth2 form-based login (used by Swagger UI authorize button)."""
    user = (
        db.query(User).filter(User.username == form.username).first()
        or db.query(User).filter(User.email == form.username).first()
    )
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Tên đăng nhập hoặc mật khẩu không đúng")
    token = create_access_token(user.id)
    return TokenResponse(access_token=token, user=UserPublic.model_validate(user))


@router.get("/me", response_model=UserPublic)
def get_me(current_user: Annotated[User, Depends(require_user)]):
    """Return the currently authenticated user's profile."""
    return current_user
